import { parseCliArgs } from '../runtime/cli.mjs';
import { pauseRun } from '../runtime/control.mjs';
import { appendOperatorAction } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTasks, persistRunContext, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const operatorArg = options.by;
const reason = options.reason ?? 'Paused by operator';

// 中文注释：pause 命令用于显式冻结一个 run，后续 run/retry 都会尊重这个控制面状态。
const run = await loadOrCreateRun(runId);
const operator = operatorArg ?? run.orchestrationState?.primaryOwner ?? 'manual';
const tasks = await loadRunTasks(run);
const refreshedRun = await refreshRunState(run, tasks);
const pausedRun = pauseRun(refreshedRun, operator, reason);

const savedRun = await persistRunContext({
  run: pausedRun,
  operator,
  previousRun: run,
  tasks,
  action: 'pause run',
});
await appendOperatorAction(savedRun.runId, 'pause', operator, reason);

console.log(`Paused run ${savedRun.runId}. Reason: ${reason}`);
