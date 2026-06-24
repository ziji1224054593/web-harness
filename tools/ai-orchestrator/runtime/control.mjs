/**
 * 第三批控制面：让 run 具备显式的暂停/恢复能力，而不是依赖人工改 JSON。
 */

import { normalizeOrchestrationState } from './run-state.mjs';

const nowIso = () => new Date().toISOString();

export const pauseRun = (run, operator, reason) => ({
  ...run,
  updatedAt: nowIso(),
  status: 'paused',
  controlState: {
    paused: true,
    reason,
    updatedAt: nowIso(),
    updatedBy: operator,
  },
});

export const resumeRun = (run, operator, reason) => ({
  ...run,
  updatedAt: nowIso(),
  controlState: {
    paused: false,
    reason,
    updatedAt: nowIso(),
    updatedBy: operator,
  },
});

export const handoffRunOwnership = (run, operator, nextOwner, reason, { currentStageId, coordinationStatus = 'clear', note = '' } = {}) => {
  const timestamp = nowIso();
  const orchestrationState = normalizeOrchestrationState(run.orchestrationState, run.updatedAt ?? timestamp, run.controlState?.updatedBy ?? operator);

  if (!nextOwner) {
    throw new Error('Ownership handoff requires a next owner.');
  }

  if (orchestrationState.primaryOwner !== operator && orchestrationState.primaryOwner !== 'system') {
    throw new Error(
      `Run ${run.runId} is currently owned by ${orchestrationState.primaryOwner}. Only the current primary orchestrator can hand it off.`
    );
  }

  return {
    ...run,
    updatedAt: timestamp,
    orchestrationState: {
      ...orchestrationState,
      primaryOwner: nextOwner,
      ...(currentStageId ? { currentStageId } : {}),
      coordinationStatus,
      ...(note ? { note } : {}),
      updatedAt: timestamp,
      updatedBy: operator,
    },
    controlState: {
      ...(run.controlState ?? {}),
      paused: run.controlState?.paused ?? false,
      reason,
      updatedAt: timestamp,
      updatedBy: operator,
    },
  };
};

export const takeoverRunOwnership = (run, operator, reason, { currentStageId, coordinationStatus = 'watch', note = '' } = {}) => {
  const timestamp = nowIso();
  const orchestrationState = normalizeOrchestrationState(run.orchestrationState, run.updatedAt ?? timestamp, run.controlState?.updatedBy ?? operator);

  return {
    ...run,
    updatedAt: timestamp,
    orchestrationState: {
      ...orchestrationState,
      primaryOwner: operator,
      ...(currentStageId ? { currentStageId } : {}),
      coordinationStatus,
      ...(note ? { note } : {}),
      updatedAt: timestamp,
      updatedBy: operator,
    },
    controlState: {
      ...(run.controlState ?? {}),
      paused: run.controlState?.paused ?? false,
      reason,
      updatedAt: timestamp,
      updatedBy: operator,
    },
  };
};
