import { isTaskRecoveryApproved, recoverApprovedTask } from '../runtime/approvals.mjs';
import { parseCliArgs } from '../runtime/cli.mjs';
import { appendOperatorAction, appendRunEvent } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTaskEntries, persistRunContext, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const operatorArg = options.by;
const reason = options.reason ?? 'Recovered by operator';
const onlyTaskId = options.task;

// 中文注释：recover 只恢复“已批准且依赖满足”的任务，避免跳过显式审批。
const run = await loadOrCreateRun(runId);
const operator = operatorArg ?? run.orchestrationState?.primaryOwner ?? 'manual';
const taskEntries = await loadRunTaskEntries(run);
const tasks = taskEntries.map((entry) => entry.task);
const completedTaskIds = new Set(tasks.filter((task) => ['done', 'reviewed'].includes(task.status)).map((task) => task.id));

const recoveredTaskIds = [];

for (const entry of taskEntries) {
  const { task } = entry;
  if (onlyTaskId && task.id !== onlyTaskId) continue;
  if (!['blocked', 'failed'].includes(task.status)) continue;
  if (!isTaskRecoveryApproved(task)) continue;

  const dependenciesSatisfied = task.dependsOn.every((dependencyId) => completedTaskIds.has(dependencyId));
  if (!dependenciesSatisfied) continue;

  recoverApprovedTask(task, operator, reason);
  recoveredTaskIds.push(task.id);

  await appendRunEvent(
    runId,
    'task.ready',
    {
      status: 'ready',
    },
    task.id
  );
}

const refreshedRun = await refreshRunState(run, tasks);
const savedRun = await persistRunContext({
  run: refreshedRun,
  operator,
  previousRun: run,
  taskEntries,
  tasks,
  action: 'recover tasks',
});
await appendOperatorAction(savedRun.runId, 'recover', operator, reason, {
  taskId: onlyTaskId,
  targetStatus: recoveredTaskIds.length > 0 ? 'ready' : 'unchanged',
});

console.log(`Recovered tasks for run ${savedRun.runId}: ${recoveredTaskIds.join(', ') || 'none'}`);
