import { projectChannel } from '../runtime/channel.mjs';
import { parseCliArgs } from '../runtime/cli.mjs';
import { appendRunEvent } from '../runtime/events.mjs';

/**
 * ai:post —— 任务对接群"发言"动词。
 *
 * 只做沟通层：追加一条 channel.message 事件（自动播报到 IM 群），并重投影 channel.md。
 * **不改运行态、不推进 Gate**——状态推进仍走 ai:run / ai:artifact / ai:approve / ai:retry 与人工确认门禁。
 *
 * 用法：
 *   ai:post -- --run X --from frontend --to qa --kind done --task FE-001 --text "登录页完成，已交接"
 *   kind: dispatch | claim | done | handoff | reject | pass | note(默认)
 */

const KINDS = new Set(['open', 'dispatch', 'claim', 'done', 'handoff', 'reject', 'pass', 'note']);

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const from = options.from ?? 'system';
const to = options.to ?? 'all';
const kind = (options.kind ?? 'note').toLowerCase();
const taskId = options.task;
const text = options.text ?? '';

if (!KINDS.has(kind)) {
  throw new Error(`未知发言类型 --kind=${kind}；可选：${[...KINDS].join(', ')}`);
}

const event = await appendRunEvent(
  runId,
  'channel.message',
  {
    from,
    to,
    kind,
    ...(text ? { text } : {}),
  },
  taskId
);

const projection = await projectChannel(runId);

console.log(`[群] ${from} 在 ${runId} 发言（${kind}${taskId ? ` @${taskId}` : ''}）已记录。`);
console.log(`     事件: ${event.eventId}`);
console.log(`     群对话: ${projection.path}（共 ${projection.messageCount} 条）`);
if (kind === 'done') {
  console.log('     提醒：交接 QA 仍需登记 current_frontend_handoff（ai:artifact）并经人工确认。');
}
if (kind === 'reject') {
  console.log('     提醒：打回返工请用 ai:retry 让任务回流（受返工熔断约束）。');
}
