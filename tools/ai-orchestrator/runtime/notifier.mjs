/**
 * IM 通知层（出站）：把 RUN 事件播报到真实 IM 群（Slack / 飞书），或在未配置时回落到 console 干跑。
 *
 * 设计原则：
 * - **仓内事件流仍是唯一事实源**；本模块只做"呈现/通知"，不写运行态、不改 Gate。
 * - **best-effort**：网络/配置失败只告警，绝不抛进 run 执行路径（不能因为群没发出去就让任务失败）。
 * - **密钥走 env，不入仓**：webhook URL 从环境变量读取。
 *
 * 环境变量：
 * - `AI_ORCH_IM_PROVIDER` = `console`(默认) | `slack` | `feishu`
 * - `AI_ORCH_IM_WEBHOOK`  = 默认/兜底 webhook（未配置 per-role 时所有身份共用此机器人）
 * - `AI_ORCH_IM_SECRET`   = 默认机器人的飞书「签名校验」密钥
 * - `AI_ORCH_IM_KEYWORD`  = 默认机器人的飞书「自定义关键词」（会前缀到消息）
 * - `AI_ORCH_IM_MUTE`     = `1` 时完全静默（不 console 也不推送）
 *
 * **每身份独立机器人（推荐）**：给某个角色单独建飞书机器人后，配置带角色后缀的变量，
 * 该角色的发言就会从它自己的机器人发出（在群里显示为不同发送者）；未配置的角色回落到默认机器人。
 * 角色后缀 = 角色名大写（如 lead_orchestrator → LEAD_ORCHESTRATOR）：
 * - `AI_ORCH_IM_WEBHOOK_PRODUCT` / `AI_ORCH_IM_SECRET_PRODUCT` / `AI_ORCH_IM_KEYWORD_PRODUCT`
 * - `AI_ORCH_IM_WEBHOOK_FRONTEND` / `..._QA` / `..._REVIEW` / `..._ARCHITECTURE` / `..._UX` / ...
 * 非角色发起的系统事件（task.ready / gate.updated 等）走 `system` 后缀或默认机器人。
 */

import { createHmac } from 'node:crypto';

const PROVIDER = (process.env.AI_ORCH_IM_PROVIDER || 'console').toLowerCase();
const MUTED = process.env.AI_ORCH_IM_MUTE === '1';

// 按角色解析投递目标：优先 `<BASE>_<ROLE>`，回落到默认 `<BASE>`。在调用时读 env，便于 per-role 配置即时生效。
const envFor = (base, role) => {
  if (role) {
    const scoped = process.env[`${base}_${role.toUpperCase()}`];
    if (scoped) return scoped;
  }
  return process.env[base] || '';
};

const resolveTarget = (role) => ({
  role: role || 'system',
  webhook: envFor('AI_ORCH_IM_WEBHOOK', role),
  secret: envFor('AI_ORCH_IM_SECRET', role),
  keyword: envFor('AI_ORCH_IM_KEYWORD', role),
});

// 哪些事件值得播报到群（避免把每条内部状态都刷屏）。channel.message 永远播报。
const NOTIFY_EVENTS = new Set(['channel.message', 'task.ready', 'task.completed', 'task.blocked', 'gate.updated', 'operator.action']);

const ROLE_ICON = {
  product: '🧭',
  architecture: '🏛️',
  ux: '🎨',
  frontend: '💻',
  qa: '🧪',
  review: '🔎',
  lead_orchestrator: '🧰',
  integration: '🔌',
  backend: '🗄️',
  devops: '⚙️',
  system: '🤖',
};

const KIND_LABEL = {
  open: '建群集合',
  dispatch: '派发任务',
  claim: '领取任务',
  done: '完成并交接',
  handoff: '交接',
  reject: '打回返工',
  pass: '验收通过',
  note: '说明',
};

/** 把一条事件渲染为一行人类可读的群消息文本。返回 null 表示不播报。 */
export const formatEventMessage = (event) => {
  if (!event || !NOTIFY_EVENTS.has(event.eventName)) return null;
  const p = event.payload ?? {};
  const taskSuffix = event.taskId ? `〔${event.taskId}〕` : '';

  if (event.eventName === 'channel.message') {
    const from = p.from ?? 'system';
    const icon = ROLE_ICON[from] ?? '💬';
    const to = p.to && p.to !== 'all' ? ` @${p.to}` : '';
    const kind = KIND_LABEL[p.kind] ?? p.kind ?? 'note';
    const text = p.text ? `：${p.text}` : '';
    return `${icon} [${from}→${kind}]${to}${taskSuffix}${text}`;
  }
  if (event.eventName === 'task.ready') return `🟢 任务就绪 ${taskSuffix}，等待对应角色领取`;
  if (event.eventName === 'task.completed') return `✅ 任务完成 ${taskSuffix}`;
  if (event.eventName === 'task.blocked') return `⛔ 任务受阻 ${taskSuffix}：${p.reason ?? ''}`;
  if (event.eventName === 'gate.updated') return `🚦 门禁 ${p.gateId} → ${p.status}`;
  if (event.eventName === 'operator.action') return `🧰 ${p.operator ?? ''} 执行 ${p.action}：${p.reason ?? ''}`;
  return null;
};

const postSlack = async (webhook, text) => {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`slack webhook responded ${res.status}`);
};

// 飞书自定义机器人「签名校验」算法：以 `timestamp\n密钥` 为 HMAC-SHA256 的 key，对空串签名后 base64。
const feishuSign = (timestamp, secret) => createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');

const postFeishu = async (webhook, secret, text) => {
  const body = { msg_type: 'text', content: { text } };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    body.timestamp = timestamp;
    body.sign = feishuSign(timestamp, secret);
  }
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // 飞书即使关键词/签名不符也回 HTTP 200，但 body.code 非 0；必须看 code 才能判定成功。
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (typeof data?.code === 'number' && data.code !== 0)) {
    throw new Error(`feishu webhook error: http=${res.status} code=${data?.code ?? '?'} msg=${data?.msg ?? ''}`);
  }
};

/**
 * 把一条事件播报到 IM 群。best-effort：失败只 warn，不抛错。
 * 返回 { delivered, provider, text }，便于调用方记录/测试。
 */
export const notifyEvent = async (event, runId) => {
  const text = formatEventMessage(event);
  if (!text || MUTED) return { delivered: false, provider: PROVIDER, text };

  // 按发言角色路由到各自机器人：channel.message 用 payload.from，其余系统事件归 system。
  const role = event?.eventName === 'channel.message' ? (event.payload?.from ?? 'system') : 'system';
  const target = resolveTarget(role);

  // KEYWORD 前缀用于飞书「自定义关键词」安全校验：消息必须包含该关键词才会被接收。
  const line = `${target.keyword ? `${target.keyword} ` : ''}[${runId ?? event?.runId ?? 'run'}] ${text}`;
  try {
    if (PROVIDER === 'slack' && target.webhook) {
      await postSlack(target.webhook, line);
      return { delivered: true, provider: 'slack', role: target.role, text: line };
    }
    if (PROVIDER === 'feishu' && target.webhook) {
      await postFeishu(target.webhook, target.secret, line);
      return { delivered: true, provider: 'feishu', role: target.role, text: line };
    }
    // console 干跑（默认）或该角色无 webhook 时的回落：打到 stdout，便于本地观察与测试。
    console.log(`[群][${target.role}] ${line}`);
    return { delivered: PROVIDER === 'console', provider: 'console', role: target.role, text: line };
  } catch (error) {
    console.warn(`[群][warn] IM 推送失败（已忽略，不影响运行态）：${error.message}`);
    return { delivered: false, provider: PROVIDER, role: target.role, text: line, error: error.message };
  }
};

// 列出当前已为哪些角色配置了独立机器人（便于自检"还差哪些身份"）。
const KNOWN_ROLES = ['product', 'architecture', 'ux', 'frontend', 'qa', 'review', 'lead_orchestrator', 'integration', 'backend', 'devops', 'system'];

export const notifierConfig = () => ({
  provider: PROVIDER,
  defaultWebhookConfigured: Boolean(process.env.AI_ORCH_IM_WEBHOOK),
  perRoleWebhooks: Object.fromEntries(KNOWN_ROLES.map((r) => [r, Boolean(process.env[`AI_ORCH_IM_WEBHOOK_${r.toUpperCase()}`])])),
  muted: MUTED,
});
