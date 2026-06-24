import { parseCliArgs } from '../runtime/cli.mjs';
import { handoffRunOwnership, takeoverRunOwnership } from '../runtime/control.mjs';
import { appendOperatorAction } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTasks, persistRunContext, refreshRunState } from '../runtime/planner.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const operatorArg = options.by;
const nextOwner = options.to;
const reason = options.reason ?? 'Ownership handoff';
const takeover = options.takeover === 'true';
const currentStageId = options.stage;
const coordinationStatus = options['coordination-status'];
const note = options.note ?? '';

if (!takeover && !nextOwner) {
  throw new Error('handoff 命令在非 takeover 模式下必须通过 --to 指定下一位主编排者。');
}

// 中文注释：handoff 命令显式记录主编排者交接；takeover 模式用于人工确认后的接管，不再依赖手改 run state。
const run = await loadOrCreateRun(runId);
const operator = operatorArg ?? run.orchestrationState?.primaryOwner ?? 'manual';
const tasks = await loadRunTasks(run);
const refreshedRun = await refreshRunState(run, tasks);
const updatedRun = takeover
  ? takeoverRunOwnership(refreshedRun, operator, reason, {
      currentStageId,
      ...(coordinationStatus ? { coordinationStatus } : {}),
      ...(note ? { note } : {}),
    })
  : handoffRunOwnership(refreshedRun, operator, nextOwner, reason, {
      currentStageId,
      ...(coordinationStatus ? { coordinationStatus } : {}),
      ...(note ? { note } : {}),
    });

const savedRun = await persistRunContext({
  run: updatedRun,
  operator,
  previousRun: run,
  tasks,
  action: takeover ? 'take over run ownership' : 'handoff run ownership',
});
await appendOperatorAction(savedRun.runId, takeover ? 'ownership.takeover' : 'ownership.handoff', operator, reason, {
  previousOwner: refreshedRun.orchestrationState?.primaryOwner ?? 'system',
  nextOwner: savedRun.orchestrationState.primaryOwner,
  currentStageId: savedRun.orchestrationState.currentStageId,
  coordinationStatus: savedRun.orchestrationState.coordinationStatus,
});

console.log(`${takeover ? 'Took over' : 'Handed off'} run ${savedRun.runId}. Primary owner: ${savedRun.orchestrationState.primaryOwner}.`);
