import { parseCliArgs } from '../runtime/cli.mjs';
import { loadOrCreateRun, loadRunTasks, persistRunContext, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';

// 中文注释：sync 只负责把结构化状态投影为 JSON 和 Markdown 产物。
const run = await loadOrCreateRun(runId);
const tasks = await loadRunTasks(run);
const refreshedRun = await refreshRunState(run, tasks);

const savedRun = await persistRunContext({
  run: refreshedRun,
  operator: refreshedRun.orchestrationState?.primaryOwner ?? refreshedRun.controlState?.updatedBy ?? 'system',
  previousRun: run,
  tasks,
  action: 'sync projections',
});

console.log(`Synced projections for run ${savedRun.runId}.`);
