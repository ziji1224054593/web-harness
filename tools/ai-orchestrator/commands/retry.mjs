import { parseCliArgs } from '../runtime/cli.mjs';
import { appendOperatorAction, appendRunEvent } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTaskEntries, persistRunContext, refreshRunState } from '../runtime/planner.mjs';
import { canReworkAgain, registerReworkRound } from '../runtime/run-policy.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const operatorArg = options.by;
const reason = options.reason ?? 'Retry blocked or failed tasks';

// 中文注释：retry 只把可重试的 blocked/failed 任务退回到 ready，不负责强行跳过依赖。
const run = await loadOrCreateRun(runId);
const operator = operatorArg ?? run.orchestrationState?.primaryOwner ?? 'manual';

// 返工熔断：每次 retry 视为一轮返工，触顶则拒绝继续循环并升级人工裁决。
const reworkDecision = canReworkAgain(run.reworkState);
if (!reworkDecision.allowed) {
  console.error(`[ai:retry] ${reworkDecision.reason}`);
  await appendOperatorAction(run.runId, 'retry-blocked', operator, reworkDecision.reason);
  process.exitCode = 1;
  throw new Error(reworkDecision.reason);
}
run.reworkState = registerReworkRound(run.reworkState, reason, operator);

const taskEntries = await loadRunTaskEntries(run);
const tasks = taskEntries.map((entry) => entry.task);
const completedTaskIds = new Set(tasks.filter((task) => ['done', 'reviewed'].includes(task.status)).map((task) => task.id));

for (const task of tasks) {
  if (!['blocked', 'failed'].includes(task.status)) continue;

  const canRetry = task.dependsOn.every((dependencyId) => completedTaskIds.has(dependencyId));
  if (canRetry) {
    task.status = 'ready';
    task.metadata = {
      ...(task.metadata ?? {}),
      lastOperatorAction: 'retry',
      lastOperatorReason: reason,
    };
    await appendRunEvent(
      runId,
      'task.ready',
      {
        status: 'ready',
      },
      task.id
    );
  }
}

const refreshedRun = await refreshRunState(run, tasks);
const savedRun = await persistRunContext({
  run: refreshedRun,
  operator,
  previousRun: run,
  taskEntries,
  tasks,
  action: 'retry tasks',
});
await appendOperatorAction(savedRun.runId, 'retry', operator, reason);

console.log(`Retried eligible tasks for run ${savedRun.runId}. Ready queue: ${savedRun.readyQueue.join(', ') || 'none'}`);
