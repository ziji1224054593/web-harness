import { parseCliArgs } from '../runtime/cli.mjs';
import { readOperatorActions, readRunEvents } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTasks, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';

// 中文注释：report 命令先输出最小摘要，后续可以再接更丰富的展示层。
const run = await loadOrCreateRun(runId);
const tasks = await loadRunTasks(run);
const refreshedRun = await refreshRunState(run, tasks);
const operatorActions = await readOperatorActions(refreshedRun.runId, 5);
const events = await readRunEvents(refreshedRun.runId, 5);

console.log(
  JSON.stringify(
    {
      runId: refreshedRun.runId,
      revision: refreshedRun.revision,
      status: refreshedRun.status,
      controlState: refreshedRun.controlState,
      orchestrationState: refreshedRun.orchestrationState,
      lockState: refreshedRun.lockState,
      projectionState: refreshedRun.projectionState,
      taskIndexState: refreshedRun.taskIndexState,
      executionState: refreshedRun.executionState,
      readyQueue: refreshedRun.readyQueue,
      completedTasks: refreshedRun.completedTasks,
      blockedTasks: refreshedRun.blockedTasks,
      failedTasks: refreshedRun.failedTasks,
      gateStates: refreshedRun.gateStates,
      artifacts: refreshedRun.artifacts,
      supersededArtifacts: refreshedRun.supersededArtifacts,
      recentOperatorActions: operatorActions,
      recentEvents: events,
    },
    null,
    2
  )
);
