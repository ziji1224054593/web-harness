import { markTaskApproved } from '../runtime/approvals.mjs';
import { parseCliArgs } from '../runtime/cli.mjs';
import { appendOperatorAction } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTaskEntries, persistRunContext, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const taskId = options.task;
const operatorArg = options.by;
const reason = options.reason ?? 'Approved by operator';

if (!taskId) {
  throw new Error('approve 命令必须通过 --task 指定任务 ID。');
}

// 中文注释：approve 只记录人工批准，不直接推进任务执行。
const run = await loadOrCreateRun(runId);
const operator = operatorArg ?? run.orchestrationState?.primaryOwner ?? 'manual';
const taskEntries = await loadRunTaskEntries(run);
const tasks = taskEntries.map((entry) => entry.task);
const targetEntry = taskEntries.find((entry) => entry.task.id === taskId);

if (!targetEntry) {
  throw new Error(`未找到任务 ${taskId}。`);
}

markTaskApproved(targetEntry.task, operator, reason);

const refreshedRun = await refreshRunState(run, tasks);
const savedRun = await persistRunContext({
  run: refreshedRun,
  operator,
  previousRun: run,
  taskEntries,
  tasks,
  action: 'approve task',
});
await appendOperatorAction(savedRun.runId, 'approve', operator, reason, {
  taskId,
  targetStatus: targetEntry.task.status,
});

console.log(`Approved task ${taskId}. Recovery is now allowed when dependencies are satisfied.`);
