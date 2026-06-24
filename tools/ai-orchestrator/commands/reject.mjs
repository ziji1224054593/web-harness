import { markTaskRejected } from '../runtime/approvals.mjs';
import { parseCliArgs } from '../runtime/cli.mjs';
import { appendOperatorAction } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTaskEntries, persistRunContext, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const taskId = options.task;
const operatorArg = options.by;
const reason = options.reason ?? 'Rejected by operator';

if (!taskId) {
  throw new Error('reject 命令必须通过 --task 指定任务 ID。');
}

// 中文注释：reject 用于显式驳回任务，后续 recover 不会再自动拾取。
const run = await loadOrCreateRun(runId);
const operator = operatorArg ?? run.orchestrationState?.primaryOwner ?? 'manual';
const taskEntries = await loadRunTaskEntries(run);
const tasks = taskEntries.map((entry) => entry.task);
const targetEntry = taskEntries.find((entry) => entry.task.id === taskId);

if (!targetEntry) {
  throw new Error(`未找到任务 ${taskId}。`);
}

markTaskRejected(targetEntry.task, operator, reason);

const refreshedRun = await refreshRunState(run, tasks);
const savedRun = await persistRunContext({
  run: refreshedRun,
  operator,
  previousRun: run,
  taskEntries,
  tasks,
  action: 'reject task',
});
await appendOperatorAction(savedRun.runId, 'reject', operator, reason, {
  taskId,
  targetStatus: targetEntry.task.status,
});

console.log(`Rejected task ${taskId}. Task remains blocked until a new approval is granted.`);
