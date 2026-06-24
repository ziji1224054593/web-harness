/**
 * 任务执行状态看板渲染器(浅色 · 接力轨)。
 *
 * 输入：一条 RUN 的运行态(run)、任务列表(tasks)、最近事件(events)。
 * 输出：自包含 HTML —— 群(RUN)/阶段接力轨/任务在哪一棒/各身份在岗/群最新动态。
 * 纯函数：不读文件、不依赖时钟(generatedAt 由调用方传入)，命令层与测试复用。
 */

const ROLE_ORDER = ['product', 'architecture', 'ux', 'frontend', 'qa', 'review', 'lead_orchestrator', 'integration', 'backend', 'devops'];
const ROLE_CN = {
  product: '产品',
  architecture: '架构',
  ux: '交互',
  frontend: '前端',
  qa: '测试',
  review: '审查',
  lead_orchestrator: '调度',
  integration: '联调',
  backend: '后端',
  devops: '工程',
};
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
};
const GATES = [
  ['G1', '需求提炼'],
  ['G2', '模块扫描'],
  ['G3', '交互对齐'],
  ['G4', '前端实现'],
  ['G5', '校验'],
  ['G6', '交付审查'],
];
const TASK_STATUS = {
  todo: ['待开始', 'todo'],
  ready: ['就绪待领', 'ready'],
  running: ['进行中', 'active'],
  done: ['已完成', 'done'],
  reviewed: ['已完成', 'done'],
  blocked: ['受阻', 'blocked'],
  failed: ['失败', 'blocked'],
};
const KIND_LABEL = {
  open: '建群集合',
  dispatch: '派发',
  claim: '领取',
  done: '完成交接',
  handoff: '交接',
  reject: '打回',
  pass: '通过',
  note: '说明',
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stageState = (s) => (s === 'passed' ? 'done' : s === 'in_progress' ? 'active' : s === 'blocked' ? 'blocked' : 'todo');
const STATUS_CN = { planning: '规划中', running: '进行中', paused: '已暂停', blocked: '受阻', completed: '已交付', failed: '失败' };

/** 推导某角色当前在岗状态：进行中 > 待领取 > 受阻 > 等待上游 > 已交付/待命。 */
const roleStatus = (role, tasks) => {
  const mine = tasks.filter((t) => t.ownerRole === role);
  const pick = (st) => mine.find((t) => (Array.isArray(st) ? st.includes(t.status) : t.status === st));
  if (pick('running')) return { label: '进行中', cls: 'active', task: pick('running').id };
  if (pick('ready')) return { label: '待领取', cls: 'ready', task: pick('ready').id };
  if (pick(['blocked', 'failed'])) return { label: '受阻', cls: 'blocked', task: pick(['blocked', 'failed']).id };
  if (mine.length && mine.every((t) => t.status === 'done' || t.status === 'reviewed')) return { label: '已交付', cls: 'done', task: '' };
  if (pick('todo')) return { label: '等待上游', cls: 'wait', task: '' };
  return { label: '待命', cls: 'wait', task: '' };
};

const TOKENS = `
:root{
  --ground:#F2F3F9;--surface:#FFFFFF;--ink:#1A1B2E;--muted:#71748A;
  --line:#E4E5F0;--line-2:#D3D5E4;
  --brand:#5B5BD6;--done:#12805C;--alert:#DC4C4C;
  --brand-s:#ECECFB;--done-s:#E1F2EA;--alert-s:#FBE9E9;--todo-s:#EBECF3;
  --shadow:0 1px 2px rgba(26,27,46,.04),0 10px 30px -18px rgba(26,27,46,.22);
  --mono:ui-monospace,"SFMono-Regular","Cascadia Code",Consolas,Menlo,monospace;
  --sans:"Inter",system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}
*{box-sizing:border-box}
.mono{font-family:var(--mono)}
.chip{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px;background:var(--todo-s);color:var(--muted);white-space:nowrap;letter-spacing:.01em}
.chip.done{background:var(--done-s);color:var(--done)}
.chip.active{background:var(--brand);color:#fff}
.chip.ready{background:var(--surface);color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand)}
.chip.blocked{background:var(--alert);color:#fff}
.eyebrow{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--brand)}
`;

export const renderBoardHtml = (run, tasks = [], events = [], { standalone = false, generatedAt = '', autoRefresh = 0 } = {}) => {
  const gs = new Map((run?.gateStates ?? []).map((g) => [g.gateId, g.status]));
  const tier = run?.tier ?? 'standard';
  const rew = run?.reworkState ?? { rounds: 0, maxRounds: 3 };
  const owner = run?.orchestrationState?.primaryOwner ?? '—';
  const runStatus = run?.status ?? 'planning';

  const rail = GATES.map(([id, name], i) => {
    const st = stageState(gs.get(id));
    const lit = i > 0 && stageState(gs.get(GATES[i - 1][0])) === 'done';
    const mark = st === 'done' ? '✓' : st === 'blocked' ? '!' : String(i + 1);
    return `<div class="rnode ${st} ${lit ? 'lit' : ''}"><span class="rdot">${mark}</span><span class="rsn">${name}</span><span class="rgid mono">${id}</span></div>`;
  }).join('');

  const taskRows = tasks.length
    ? tasks
        .map((t) => {
          const [label, cls] = TASK_STATUS[t.status] ?? [t.status, 'todo'];
          return `<tr>
          <td class="mono tid">${esc(t.id)}</td>
          <td class="ttitle">${esc(t.title)}<span class="tsub mono">${esc(t.type ?? '')}</span></td>
          <td class="towner">${ROLE_ICON[t.ownerRole] ?? '•'} ${ROLE_CN[t.ownerRole] ?? esc(t.ownerRole)}</td>
          <td><span class="chip ${cls}">${label}</span></td>
          <td class="mono tdim">${esc((t.dependsOn ?? []).join(', ') || '—')}</td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="tempty">还没有任务。产品收敛需求后由调度派发，任务会逐条出现在这里。</td></tr>`;

  const roster = [...new Set([...tasks.map((t) => t.ownerRole).filter(Boolean), 'lead_orchestrator'])].sort(
    (a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)
  );
  const rosterRows = roster
    .map((role) => {
      const s = role === 'lead_orchestrator' ? { label: '调度中', cls: 'active', task: '' } : roleStatus(role, tasks);
      return `<div class="rr">
      <span class="rr-av">${ROLE_ICON[role] ?? '•'}</span>
      <span class="rr-name">${ROLE_CN[role] ?? esc(role)}<span class="rr-code mono">${esc(role)}</span></span>
      <span class="chip ${s.cls}">${s.label}</span>
      ${s.task ? `<span class="rr-task mono">${esc(s.task)}</span>` : ''}
    </div>`;
    })
    .join('');

  const msgs = (events ?? []).filter((e) => e.eventName === 'channel.message').slice(-6);
  const chat = msgs.length
    ? msgs
        .map((e) => {
          const p = e.payload ?? {};
          const rej = p.kind === 'reject';
          const who = `${ROLE_CN[p.from] ?? esc(p.from)} · ${KIND_LABEL[p.kind] ?? esc(p.kind)}${p.to && p.to !== 'all' ? ' → ' + (ROLE_CN[p.to] ?? esc(p.to)) : ''}${e.taskId ? ' · ' + esc(e.taskId) : ''}`;
          return `<div class="msg ${rej ? 'rej' : ''}"><span class="msg-av">${ROLE_ICON[p.from] ?? '💬'}</span><div class="msg-b"><span class="msg-who">${who}</span>${esc(p.text) ? `<span class="msg-t">${esc(p.text)}</span>` : ''}</div></div>`;
        })
        .join('')
    : '<div class="msg"><div class="msg-b"><span class="msg-t tdim">群里还没有动态。</span></div></div>';

  const body = `<div class="wrap">
  <header class="bhead">
    <div class="bh-l">
      <span class="eyebrow">任务对接群 · Task channel</span>
      <h1>${esc(run?.runId ?? 'RUN')}</h1>
      <span class="pipe mono">${esc(run?.pipelineId ?? 'page-delivery')}</span>
    </div>
    <div class="bh-r">
      <span class="status status-${runStatus}">${STATUS_CN[runStatus] ?? esc(runStatus)}</span>
      <div class="metas">
        <span class="meta"><b>档位</b><i class="mono">${esc(tier)}</i></span>
        <span class="meta"><b>群主</b><i class="mono">${esc(owner)}</i></span>
        <span class="meta"><b>返工</b><i class="mono ${rew.rounds >= rew.maxRounds ? 'over' : ''}">${rew.rounds}/${rew.maxRounds}</i></span>
      </div>
    </div>
  </header>

  <section class="rail" aria-label="阶段接力轨">${rail}</section>

  <div class="cols">
    <section class="card">
      <div class="card-h"><h2>任务在哪一棒</h2><span class="count">${tasks.length} 个任务</span></div>
      <table class="tt">
        <thead><tr><th>任务</th><th>内容</th><th>负责身份</th><th>状态</th><th>依赖</th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </section>
    <section class="card">
      <div class="card-h"><h2>各身份在岗</h2></div>
      <div class="roster">${rosterRows}</div>
    </section>
  </div>

  <section class="card">
    <div class="card-h"><h2>群最新动态</h2><span class="count mono">channel.md</span></div>
    <div class="chat">${chat}</div>
  </section>

  ${generatedAt || autoRefresh ? `<p class="foot mono">${generatedAt ? `快照 ${esc(generatedAt)} · ` : ''}事实源 runs/${esc(run?.runId ?? '')}.json${autoRefresh ? ` · 每 ${autoRefresh}s 自动刷新` : ''}</p>` : ''}
  </div>`;

  const style = `<style>${TOKENS}
  .wrap{background:var(--ground);color:var(--ink);font-family:var(--sans);width:100%;max-width:none;margin:0;padding:clamp(18px,3vw,40px);min-height:100vh;line-height:1.55;-webkit-font-smoothing:antialiased}
  .tdim{color:var(--muted)}
  .bhead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;margin-bottom:24px}
  .bh-l h1{font-size:clamp(26px,4.5vw,40px);font-weight:800;letter-spacing:-.025em;margin:7px 0 4px;font-family:var(--mono)}
  .pipe{font-size:12.5px;color:var(--muted)}
  .bh-r{display:flex;flex-direction:column;align-items:flex-end;gap:12px}
  .status{font-size:13px;font-weight:700;padding:5px 14px;border-radius:999px;background:var(--brand-s);color:var(--brand)}
  .status-running{background:var(--brand-s);color:var(--brand)} .status-blocked,.status-failed{background:var(--alert-s);color:var(--alert)} .status-completed{background:var(--done-s);color:var(--done)} .status-paused{background:var(--todo-s);color:var(--muted)}
  .metas{display:flex;gap:18px;flex-wrap:wrap}
  .meta{display:flex;flex-direction:column;gap:2px;align-items:flex-end;font-size:14px}
  .meta b{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .meta i{font-style:normal;font-weight:650;color:var(--ink)} .meta i.over{color:var(--alert)}
  .rail{display:flex;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:24px 12px;margin-bottom:18px;overflow-x:auto}
  .rnode{flex:1 0 90px;display:flex;flex-direction:column;align-items:center;gap:9px;position:relative;padding:0 4px}
  .rnode::before{content:"";position:absolute;top:19px;left:-50%;width:100%;height:2px;background:var(--line-2);z-index:0}
  .rnode:first-child::before{display:none}
  .rnode.lit::before{background:var(--done)}
  .rdot{position:relative;z-index:1;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-weight:700;font-size:15px;background:var(--surface);border:2px solid var(--line-2);color:var(--muted)}
  .rnode.done .rdot{background:var(--done);border-color:var(--done);color:#fff}
  .rnode.active .rdot{background:var(--brand);border-color:var(--brand);color:#fff;box-shadow:0 0 0 5px var(--brand-s);animation:pulse 1.9s ease-in-out infinite}
  .rnode.blocked .rdot{background:var(--alert);border-color:var(--alert);color:#fff}
  .rsn{font-size:13px;font-weight:650;color:var(--ink);text-align:center}
  .rnode.todo .rsn{color:var(--muted)}
  .rgid{font-size:10px;color:var(--muted)}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 4px var(--brand-s)}50%{box-shadow:0 0 0 9px rgba(91,91,214,.10)}}
  @media(prefers-reduced-motion:reduce){.rnode.active .rdot{animation:none}}
  .cols{display:grid;grid-template-columns:1.7fr 1fr;gap:18px;margin-bottom:18px}
  @media(max-width:820px){.cols{grid-template-columns:1fr}}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:20px 22px}
  .card-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:14px}
  .card-h h2{font-size:15px;font-weight:750;margin:0;letter-spacing:-.01em}
  .count{font-size:12px;color:var(--muted)}
  .tt{width:100%;border-collapse:collapse;font-size:13.5px}
  .tt th{text-align:left;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:0 10px 10px;border-bottom:1px solid var(--line)}
  .tt td{padding:13px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
  .tt tr:last-child td{border-bottom:0}
  .tid{color:var(--brand);font-weight:600;font-size:12px}
  .ttitle{font-weight:600;color:var(--ink)} .tsub{display:block;font-size:10.5px;color:var(--muted);font-weight:400;margin-top:2px}
  .towner{white-space:nowrap;color:var(--ink)}
  .tdim{color:var(--muted);font-size:12px}
  .tempty{text-align:center;color:var(--muted);padding:34px 10px}
  .roster{display:flex;flex-direction:column;gap:9px}
  .rr{display:flex;align-items:center;gap:11px;padding:11px 13px;border:1px solid var(--line);border-radius:13px;background:var(--ground)}
  .rr-av{font-size:17px;flex:none;width:24px;text-align:center}
  .rr-name{display:flex;flex-direction:column;font-size:14px;font-weight:650;min-width:56px}
  .rr-code{font-size:9.5px;color:var(--muted);font-weight:400}
  .rr .chip{margin-left:auto}
  .rr-task{font-size:11px;color:var(--muted);flex:none}
  .chat{display:flex;flex-direction:column;gap:10px}
  .msg{display:flex;gap:11px;align-items:flex-start}
  .msg-av{font-size:17px;flex:none;width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:var(--ground);border:1px solid var(--line);border-radius:9px}
  .msg-b{background:var(--ground);border:1px solid var(--line);border-radius:12px;padding:9px 14px;font-size:13.5px;color:var(--ink)}
  .msg.rej .msg-b{background:var(--alert-s);border-color:#F1CFCF}
  .msg-who{display:block;font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:2px}
  .msg.rej .msg-who{color:var(--alert)}
  .foot{margin-top:22px;font-size:11px;color:var(--muted);text-align:right}
</style>`;

  if (standalone) {
    const refresh = autoRefresh ? `<meta http-equiv="refresh" content="${autoRefresh}">` : '';
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}<title>${esc(run?.runId ?? 'RUN')} · 任务执行看板</title>${style}</head><body>${body}</body></html>`;
  }
  return `<title>${esc(run?.runId ?? 'RUN')} · 任务执行看板</title>${style}${body}`;
};

/** 多 RUN 总览：扫描所有 RUN,渲染进度卡片(可点进各自看板)。 */
export const renderOverviewHtml = (entries = [], { standalone = false, generatedAt = '', autoRefresh = 0 } = {}) => {
  const isActive = (s) => s !== 'completed' && s !== 'failed';
  const sorted = [...entries].sort((a, b) => Number(isActive(b.run?.status)) - Number(isActive(a.run?.status)));

  const cards = sorted.length
    ? sorted
        .map(({ run, tasks = [] }) => {
          const gs = new Map((run?.gateStates ?? []).map((g) => [g.gateId, g.status]));
          const passed = GATES.filter(([id]) => gs.get(id) === 'passed').length;
          const current = GATES.find(([id]) => gs.get(id) !== 'passed');
          const curName = current ? current[1] : '全部通过';
          const segs = GATES.map(([id]) => `<i class="seg ${stageState(gs.get(id))}"></i>`).join('');
          const done = tasks.filter((t) => t.status === 'done' || t.status === 'reviewed').length;
          const rew = run?.reworkState ?? { rounds: 0, maxRounds: 3 };
          const s = run?.status ?? 'planning';
          return `<a class="ocard ${isActive(s) ? '' : 'idle'}" href="runs/${esc(run?.runId ?? '')}/board.html">
          <div class="oc-top"><span class="oc-id mono">${esc(run?.runId ?? '')}</span><span class="status status-${s}">${STATUS_CN[s] ?? esc(s)}</span></div>
          <div class="oc-segs">${segs}</div>
          <div class="oc-stage">当前在 <b>${esc(curName)}</b> · 门禁 ${passed}/6</div>
          <div class="oc-meta">
            <span><b class="mono">${esc(run?.tier ?? 'standard')}</b>档</span>
            <span>任务 <b class="mono">${done}/${tasks.length}</b></span>
            <span>返工 <b class="mono ${rew.rounds >= rew.maxRounds ? 'over' : ''}">${rew.rounds}/${rew.maxRounds}</b></span>
            <span>群主 <b class="mono">${esc(run?.orchestrationState?.primaryOwner ?? '—')}</b></span>
          </div>
        </a>`;
        })
        .join('')
    : '<div class="oempty">现在没有任何 RUN。<br>用 <code class="mono">ai:plan -- --run &lt;RUN_ID&gt;</code> 建一条需求流水线，这里会出现它的进度卡片。</div>';

  const activeCount = sorted.filter((e) => isActive(e.run?.status)).length;

  const body = `<div class="wrap">
    <header class="ohead">
      <div><span class="eyebrow">编排总览 · All runs</span><h1>全部 RUN 总览</h1></div>
      <div class="ocount"><b>${activeCount}</b> 活跃 <span>/ ${sorted.length} 总计</span></div>
    </header>
    <div class="ogrid">${cards}</div>
    ${generatedAt || autoRefresh ? `<p class="foot mono">${generatedAt ? `快照 ${esc(generatedAt)} · ` : ''}扫描 runs/*.json${autoRefresh ? ` · 每 ${autoRefresh}s 自动刷新` : ''}</p>` : ''}
  </div>`;

  const style = `<style>${TOKENS}
  .wrap{background:var(--ground);color:var(--ink);font-family:var(--sans);width:100%;margin:0;padding:clamp(18px,3vw,40px);min-height:100vh;line-height:1.55;-webkit-font-smoothing:antialiased}
  .ohead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:26px}
  .ohead h1{font-size:clamp(26px,4.5vw,40px);font-weight:800;letter-spacing:-.025em;margin:7px 0 0}
  .ocount{font-size:14px;color:var(--muted)} .ocount b{color:var(--brand);font-size:22px;font-weight:800}
  .status{font-size:12px;font-weight:700;padding:4px 12px;border-radius:999px;background:var(--brand-s);color:var(--brand)}
  .status-running{background:var(--brand-s);color:var(--brand)} .status-blocked,.status-failed{background:var(--alert-s);color:var(--alert)} .status-completed{background:var(--done-s);color:var(--done)} .status-paused,.status-planning{background:var(--todo-s);color:var(--muted)}
  .ogrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  .ocard{display:flex;flex-direction:column;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:20px 21px;text-decoration:none;color:var(--ink);transition:transform .14s ease,box-shadow .14s ease}
  .ocard:hover{transform:translateY(-3px);box-shadow:0 1px 2px rgba(26,27,46,.04),0 18px 40px -20px rgba(91,91,214,.45)}
  .ocard:focus-visible{outline:2px solid var(--brand);outline-offset:3px}
  .ocard.idle{opacity:.6}
  .oc-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .oc-id{font-size:14.5px;font-weight:700;color:var(--ink)}
  .oc-segs{display:flex;gap:5px}
  .seg{flex:1;height:7px;border-radius:4px;background:var(--todo-s)}
  .seg.done{background:var(--done)} .seg.active{background:var(--brand)} .seg.blocked{background:var(--alert)}
  .oc-stage{font-size:13.5px;color:var(--muted)} .oc-stage b{color:var(--ink);font-weight:700}
  .oc-meta{display:flex;flex-wrap:wrap;gap:7px 16px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:13px}
  .oc-meta b{color:var(--ink);font-weight:650} .oc-meta b.over{color:var(--alert)}
  .oempty{grid-column:1/-1;text-align:center;color:var(--muted);padding:56px 20px;border:1.5px dashed var(--line-2);border-radius:18px;font-size:14.5px;line-height:1.9}
  .oempty code{background:var(--surface);border:1px solid var(--line);color:var(--brand);padding:3px 8px;border-radius:6px;font-size:12.5px}
  .foot{margin-top:24px;font-size:11px;color:var(--muted);text-align:right}
</style>`;

  if (standalone) {
    const refresh = autoRefresh ? `<meta http-equiv="refresh" content="${autoRefresh}">` : '';
    return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}<title>全部 RUN 总览</title>${style}</head><body>${body}</body></html>`;
  }
  return `<title>全部 RUN 总览</title>${style}${body}`;
};
