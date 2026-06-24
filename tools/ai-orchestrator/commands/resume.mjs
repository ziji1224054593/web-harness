import { parseCliArgs } from '../runtime/cli.mjs';
import { resumeRun } from '../runtime/control.mjs';
import { appendOperatorAction } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTasks, persistRunContext, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const operatorArg = options.by;
const reason = options.reason ?? 'Resumed by operator';

// 中文注释：resume 会解除暂停标记，再交由 refreshRunState 重新计算真实运行态。
const run = await loadOrCreateRun(runId);
const operator = operatorArg ?? run.orchestrationState?.primaryOwner ?? 'manual';
const tasks = await loadRunTasks(run);
const resumedRun = await refreshRunState(resumeRun(run, operator, reason), tasks);

const savedRun = await persistRunContext({
  run: resumedRun,
  operator,
  previousRun: run,
  tasks,
  action: 'resume run',
});
await appendOperatorAction(savedRun.runId, 'resume', operator, reason);

console.log(`Resumed run ${savedRun.runId}. Reason: ${reason}`);
