import { GATE_DESCRIPTIONS, TASK_BLOCKED_STATUSES, TASK_SUCCESS_STATUSES } from './constants.mjs';
import { buildPipelineIndex, loadPipelineDefinition } from './contracts.mjs';

const nowIso = () => new Date().toISOString();

export const RUN_ARTIFACT_KEYS = [
  'current_ux_interaction',
  'current_frontend_handoff',
  'current_review_brief',
  'current_qa_report',
  'current_regression_report',
  'current_review_report',
  'current_delivery_report',
];

export const DEFAULT_ORCHESTRATION_MODE = 'single_writer_run';
export const DEFAULT_LOCK_STRATEGY = 'lock_file_cas';
export const DEFAULT_EXECUTION_MODE = 'multiprocess_leased';
export const DEFAULT_WORKER_LEASE_MS = 10 * 60 * 1000;

const buildGateNotes = (supportingTasks, fallback) => {
  const notes = supportingTasks
    .map((task) => task.metadata?.lastResultSummary || task.metadata?.lastValidationSummary || task.metadata?.lastResultNotes)
    .filter(Boolean);

  return notes.join(' | ') || fallback;
};

const hasRequiredEvidenceKinds = (task, requiredEvidenceKinds) =>
  requiredEvidenceKinds.every((kind) => task.evidenceRefs.some((evidence) => evidence.kind === kind));

export const createEmptyArtifactEntry = (updatedAt = nowIso(), updatedBy = 'system') => ({
  status: 'missing',
  updatedAt,
  updatedBy,
});

export const createDefaultOrchestrationState = (updatedAt = nowIso(), updatedBy = 'system') => ({
  mode: DEFAULT_ORCHESTRATION_MODE,
  primaryOwner: updatedBy,
  ownerRole: 'lead_orchestrator',
  coordinationStatus: 'clear',
  updatedAt,
  updatedBy,
});

export const createDefaultLockState = (updatedAt = nowIso(), updatedBy = 'system', runId = 'unknown') => ({
  strategy: DEFAULT_LOCK_STRATEGY,
  lockPath: `ai/runtime/locks/${runId}.lock`,
  lastHeldBy: updatedBy,
  lastAcquiredAt: updatedAt,
  lastReleasedAt: updatedAt,
  updatedAt,
  updatedBy,
});

export const normalizeLockState = (state = {}, updatedAt = nowIso(), updatedBy = 'system', runId = 'unknown') => ({
  strategy: state?.strategy ?? DEFAULT_LOCK_STRATEGY,
  lockPath: state?.lockPath ?? `ai/runtime/locks/${runId}.lock`,
  lastHeldBy: state?.lastHeldBy ?? updatedBy,
  lastAcquiredAt: state?.lastAcquiredAt ?? updatedAt,
  lastReleasedAt: state?.lastReleasedAt ?? updatedAt,
  updatedAt: state?.updatedAt ?? updatedAt,
  updatedBy: state?.updatedBy ?? updatedBy,
});

export const createDefaultProjectionState = (updatedAt = nowIso(), updatedBy = 'system') => ({
  projectionMode: 'shared_and_per_run',
  inputHash: '',
  backlogHash: '',
  gatesHash: '',
  reportHash: '',
  currentArtifactsHash: '',
  updatedAt,
  updatedBy,
});

export const normalizeProjectionState = (state = {}, updatedAt = nowIso(), updatedBy = 'system') => ({
  projectionMode: state?.projectionMode ?? 'shared_and_per_run',
  inputHash: state?.inputHash ?? '',
  backlogHash: state?.backlogHash ?? '',
  gatesHash: state?.gatesHash ?? '',
  reportHash: state?.reportHash ?? '',
  currentArtifactsHash: state?.currentArtifactsHash ?? '',
  updatedAt: state?.updatedAt ?? updatedAt,
  updatedBy: state?.updatedBy ?? updatedBy,
});

export const createDefaultTaskIndexState = (updatedAt = nowIso(), updatedBy = 'system') => ({
  indexPath: 'ai/runtime/indexes/tasks.json',
  indexHash: '',
  updatedAt,
  updatedBy,
});

export const normalizeTaskIndexState = (state = {}, updatedAt = nowIso(), updatedBy = 'system') => ({
  indexPath: state?.indexPath ?? 'ai/runtime/indexes/tasks.json',
  indexHash: state?.indexHash ?? '',
  updatedAt: state?.updatedAt ?? updatedAt,
  updatedBy: state?.updatedBy ?? updatedBy,
});

export const createDefaultExecutionState = (updatedAt = nowIso(), updatedBy = 'system', workerLeaseMs = DEFAULT_WORKER_LEASE_MS) => ({
  coordinationMode: DEFAULT_EXECUTION_MODE,
  workerLeaseMs,
  activeClaims: [],
  updatedAt,
  updatedBy,
});

export const normalizeTaskExecutionState = (state = {}) => {
  if (!state || typeof state !== 'object') return undefined;
  if (!state.leaseId || !state.claimedBy || !state.claimedAt || !state.leaseUntil) return undefined;

  return {
    leaseId: state.leaseId,
    claimedBy: state.claimedBy,
    claimedAt: state.claimedAt,
    leaseUntil: state.leaseUntil,
    attempt: typeof state.attempt === 'number' ? state.attempt : 1,
  };
};

export const deriveActiveClaims = (tasks = []) =>
  tasks
    .map((task) => {
      const executionState = normalizeTaskExecutionState(task.executionState);
      if (!executionState) return null;

      return {
        taskId: task.id,
        leaseId: executionState.leaseId,
        claimedBy: executionState.claimedBy,
        claimedAt: executionState.claimedAt,
        leaseUntil: executionState.leaseUntil,
      };
    })
    .filter(Boolean);

export const normalizeExecutionState = (state = {}, updatedAt = nowIso(), updatedBy = 'system', tasks = []) => ({
  coordinationMode: state?.coordinationMode ?? DEFAULT_EXECUTION_MODE,
  workerLeaseMs: typeof state?.workerLeaseMs === 'number' ? state.workerLeaseMs : DEFAULT_WORKER_LEASE_MS,
  activeClaims: Array.isArray(state?.activeClaims) && state.activeClaims.length > 0 ? state.activeClaims : deriveActiveClaims(tasks),
  updatedAt: state?.updatedAt ?? updatedAt,
  updatedBy: state?.updatedBy ?? updatedBy,
});

export const normalizeOrchestrationState = (state = {}, updatedAt = nowIso(), updatedBy = 'system') => ({
  mode: state?.mode ?? DEFAULT_ORCHESTRATION_MODE,
  primaryOwner: state?.primaryOwner ?? state?.updatedBy ?? updatedBy,
  ownerRole: state?.ownerRole ?? 'lead_orchestrator',
  ...(state?.currentStageId ? { currentStageId: state.currentStageId } : {}),
  coordinationStatus: state?.coordinationStatus ?? 'clear',
  ...(state?.note ? { note: state.note } : {}),
  updatedAt: state?.updatedAt ?? updatedAt,
  updatedBy: state?.updatedBy ?? updatedBy,
});

export const ensureRunWritableByOperator = (run, operator, action = 'update run state') => {
  const timestamp = nowIso();
  const normalizedState = normalizeOrchestrationState(
    run.orchestrationState,
    run.updatedAt ?? timestamp,
    run.controlState?.updatedBy ?? operator ?? 'system'
  );

  if (!operator || operator === 'system') {
    return {
      ...run,
      orchestrationState: normalizedState,
    };
  }

  if (normalizedState.primaryOwner === operator) {
    return {
      ...run,
      orchestrationState: {
        ...normalizedState,
        updatedAt: timestamp,
        updatedBy: operator,
      },
    };
  }

  if (normalizedState.primaryOwner === 'system') {
    return {
      ...run,
      orchestrationState: {
        ...normalizedState,
        primaryOwner: operator,
        updatedAt: timestamp,
        updatedBy: operator,
      },
    };
  }

  throw new Error(
    `Run ${run.runId} is currently owned by ${normalizedState.primaryOwner}. ${action} must be performed by the primary orchestrator or after an ownership handoff.`
  );
};

export const nextRevision = (revision = 0) => revision + 1;

export const normalizeRunArtifacts = (artifacts = {}, updatedAt = nowIso(), updatedBy = 'system') =>
  Object.fromEntries(
    RUN_ARTIFACT_KEYS.map((key) => [
      key,
      artifacts?.[key]
        ? {
            status: artifacts[key].status ?? (artifacts[key].path ? 'current' : 'missing'),
            ...(artifacts[key].path ? { path: artifacts[key].path } : {}),
            ...(artifacts[key].note ? { note: artifacts[key].note } : {}),
            updatedAt: artifacts[key].updatedAt ?? updatedAt,
            updatedBy: artifacts[key].updatedBy ?? updatedBy,
          }
        : createEmptyArtifactEntry(updatedAt, updatedBy),
    ])
  );

export const normalizeSupersededArtifacts = (items = [], updatedAt = nowIso(), updatedBy = 'system') =>
  (Array.isArray(items) ? items : []).map((item) => ({
    path: item.path,
    ...(item.note ? { note: item.note } : {}),
    ...(item.replacedBy ? { replacedBy: item.replacedBy } : {}),
    updatedAt: item.updatedAt ?? updatedAt,
    updatedBy: item.updatedBy ?? updatedBy,
  }));

export const deriveGateStates = async (tasks, pipelineId = 'page-delivery') => {
  const pipeline = await loadPipelineDefinition(pipelineId);
  const pipelineIndex = buildPipelineIndex(pipeline);

  return Object.entries(GATE_DESCRIPTIONS).map(([gateId]) => {
    const supportingTasks = tasks.filter((task) => task.gateTargets.includes(gateId));

    if (supportingTasks.length === 0) {
      return {
        gateId,
        status: 'todo',
        evidenceRefs: [],
        note: 'No tasks bound to this gate yet.',
      };
    }

    if (supportingTasks.some((task) => TASK_BLOCKED_STATUSES.has(task.status))) {
      return {
        gateId,
        status: 'blocked',
        evidenceRefs: supportingTasks.flatMap((task) => task.evidenceRefs.map((item) => item.path)),
        note: buildGateNotes(supportingTasks, 'At least one supporting task is blocked or failed.'),
      };
    }

    const allPassed = supportingTasks.every((task) => {
      const stage = pipelineIndex.stageByTaskType.get(task.type);
      const requiredEvidenceKinds = stage?.requiredEvidenceKinds ?? [];

      return TASK_SUCCESS_STATUSES.has(task.status) && task.evidenceRefs.length > 0 && hasRequiredEvidenceKinds(task, requiredEvidenceKinds);
    });

    if (allPassed) {
      return {
        gateId,
        status: 'passed',
        evidenceRefs: supportingTasks.flatMap((task) => task.evidenceRefs.map((item) => item.path)),
        note: buildGateNotes(supportingTasks, 'All supporting tasks have completed with evidence.'),
      };
    }

    const inProgress = supportingTasks.some((task) => task.status !== 'todo');

    return {
      gateId,
      status: inProgress ? 'in_progress' : 'todo',
      evidenceRefs: supportingTasks.flatMap((task) => task.evidenceRefs.map((item) => item.path)),
      note: inProgress ? 'Supporting tasks have started but are not all complete.' : '',
    };
  });
};
