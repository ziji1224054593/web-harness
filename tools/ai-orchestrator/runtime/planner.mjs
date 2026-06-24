import { GATE_DESCRIPTIONS, TASK_SUCCESS_STATUSES } from './constants.mjs';
import { assertValidRunState, validateTaskEntriesAgainstContracts } from './contracts.mjs';
import { syncProjections } from './projector.mjs';
import {
  createDefaultExecutionState,
  createDefaultLockState,
  createDefaultProjectionState,
  createDefaultTaskIndexState,
  deriveGateStates,
  ensureRunWritableByOperator,
  nextRevision,
  normalizeExecutionState,
  normalizeLockState,
  normalizeOrchestrationState,
  normalizeProjectionState,
  normalizeRunArtifacts,
  normalizeSupersededArtifacts,
  normalizeTaskIndexState,
} from './run-state.mjs';
import { readJsonFile, withDirectoryLock, writeJsonFile } from './store.mjs';
import { buildTaskIndex, ensureTaskIndex, loadIndexedTaskEntries, loadIndexedTaskEntriesForRun } from './task-index.mjs';
import { saveTaskEntries } from './task-state.mjs';

const nowIso = () => new Date().toISOString();
const RUN_LOCK_TIMEOUT_MS = 30000;
const RUN_LOCK_STALE_MS = 5 * 60 * 1000;

/**
 * 读取当前 runtime 中的全部任务定义。
 */
export const loadTaskEntries = async (pipelineId = 'page-delivery') => {
  const entries = await loadIndexedTaskEntries(pipelineId);
  await validateTaskEntriesAgainstContracts(entries, pipelineId);
  return entries;
};

export const loadAllTasks = async (pipelineId = 'page-delivery') => {
  const taskEntries = await loadTaskEntries(pipelineId);
  return taskEntries.map((entry) => entry.task);
};

export const filterTaskEntriesForRun = (run, taskEntries) => {
  if (!Array.isArray(run.taskIds) || run.taskIds.length === 0) {
    return taskEntries;
  }

  const allowedTaskIds = new Set(run.taskIds);
  return taskEntries.filter((entry) => allowedTaskIds.has(entry.task.id));
};

export const loadRunTaskEntries = async (run) => {
  const taskEntries = await loadIndexedTaskEntriesForRun(run);
  await validateTaskEntriesAgainstContracts(taskEntries, run.pipelineId, {
    validationScope: 'subset',
  });
  return filterTaskEntriesForRun(run, taskEntries);
};

export const loadRunTasks = async (run) => {
  const taskEntries = await loadRunTaskEntries(run);
  return taskEntries.map((entry) => entry.task);
};

/**
 * 读取指定运行记录；如果不存在，则按当前任务集创建一份新的最小 run。
 */
export const loadOrCreateRun = async (runId, pipelineId = 'page-delivery', tasks = []) => {
  try {
    const run = await readJsonFile(`ai/runtime/runs/${runId}.json`);
    const normalizedRun = {
      ...run,
      revision: typeof run.revision === 'number' ? run.revision : 0,
      gateStates: Array.isArray(run.gateStates) ? run.gateStates : [],
      controlState: run.controlState ?? {
        paused: false,
        updatedAt: run.updatedAt,
        updatedBy: 'system',
      },
      orchestrationState: normalizeOrchestrationState(run.orchestrationState, run.updatedAt, run.controlState?.updatedBy ?? 'system'),
      lockState: normalizeLockState(run.lockState, run.updatedAt, run.controlState?.updatedBy ?? 'system', run.runId ?? runId),
      projectionState: normalizeProjectionState(run.projectionState, run.updatedAt, run.controlState?.updatedBy ?? 'system'),
      taskIndexState: normalizeTaskIndexState(run.taskIndexState, run.updatedAt, run.controlState?.updatedBy ?? 'system'),
      executionState: normalizeExecutionState(run.executionState, run.updatedAt, run.controlState?.updatedBy ?? 'system', []),
      artifacts: normalizeRunArtifacts(run.artifacts, run.updatedAt, run.controlState?.updatedBy ?? 'system'),
      supersededArtifacts: normalizeSupersededArtifacts(run.supersededArtifacts, run.updatedAt, run.controlState?.updatedBy ?? 'system'),
    };
    await assertValidRunState(normalizedRun);
    return normalizedRun;
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== undefined) {
      throw error;
    }

    if (!error?.code) {
      throw error;
    }

    const runtimeTasks = tasks.length > 0 ? tasks : await loadAllTasks(pipelineId);
    const timestamp = nowIso();
    const taskIndex = await ensureTaskIndex(pipelineId);
    const nextRun = {
      runId,
      pipelineId,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 0,
      status: 'planning',
      taskIds: runtimeTasks.map((task) => task.id),
      readyQueue: [],
      blockedTasks: [],
      completedTasks: [],
      failedTasks: [],
      gateStateIds: Object.keys(GATE_DESCRIPTIONS),
      gateStates: Object.keys(GATE_DESCRIPTIONS).map((gateId) => ({
        gateId,
        status: 'todo',
        evidenceRefs: [],
        note: 'No tasks bound to this gate yet.',
      })),
      controlState: {
        paused: false,
        updatedAt: timestamp,
        updatedBy: 'system',
      },
      orchestrationState: normalizeOrchestrationState({}, timestamp, 'system'),
      lockState: createDefaultLockState(timestamp, 'system', runId),
      projectionState: createDefaultProjectionState(timestamp, 'system'),
      taskIndexState: {
        ...createDefaultTaskIndexState(timestamp, 'system'),
        indexHash: taskIndex.indexHash,
      },
      executionState: createDefaultExecutionState(timestamp, 'system'),
      artifacts: normalizeRunArtifacts({}, timestamp, 'system'),
      supersededArtifacts: [],
    };
    await assertValidRunState(nextRun);
    return nextRun;
  }
};

/**
 * 根据任务当前状态重新计算 run 的 readyQueue 和汇总桶。
 */
export const refreshRunState = (run, tasks) => {
  const timestamp = nowIso();
  const artifacts = normalizeRunArtifacts(run.artifacts, run.updatedAt ?? timestamp, run.controlState?.updatedBy ?? 'system');
  const supersededArtifacts = normalizeSupersededArtifacts(
    run.supersededArtifacts,
    run.updatedAt ?? timestamp,
    run.controlState?.updatedBy ?? 'system'
  );
  const completedTaskIds = tasks.filter((task) => TASK_SUCCESS_STATUSES.has(task.status)).map((task) => task.id);

  const readyQueue = tasks
    .filter((task) => task.status === 'ready' && task.dependsOn.every((dependencyId) => completedTaskIds.includes(dependencyId)))
    .map((task) => task.id);

  const blockedTasks = tasks.filter((task) => task.status === 'blocked').map((task) => task.id);

  const failedTasks = tasks.filter((task) => task.status === 'failed').map((task) => task.id);
  const completedTasks = completedTaskIds;

  const hasFailures = failedTasks.length > 0 || blockedTasks.length > 0;
  const allFinished = completedTasks.length === tasks.length && tasks.length > 0;
  const hasStartedWork = tasks.some((task) => task.status !== 'todo');
  const isPaused = run.controlState?.paused === true;
  const gateStatesPromise = deriveGateStates(tasks, run.pipelineId);

  return Promise.resolve(gateStatesPromise).then((gateStates) => ({
    ...run,
    updatedAt: timestamp,
    readyQueue,
    blockedTasks,
    completedTasks,
    failedTasks,
    gateStateIds: gateStates.map((gate) => gate.gateId),
    gateStates,
    status: allFinished ? 'completed' : isPaused ? 'paused' : hasFailures ? 'blocked' : hasStartedWork ? 'running' : 'planning',
    orchestrationState: normalizeOrchestrationState(run.orchestrationState, run.updatedAt ?? timestamp, run.controlState?.updatedBy ?? 'system'),
    lockState: normalizeLockState(run.lockState, run.updatedAt ?? timestamp, run.controlState?.updatedBy ?? 'system', run.runId),
    projectionState: normalizeProjectionState(run.projectionState, run.updatedAt ?? timestamp, run.controlState?.updatedBy ?? 'system'),
    taskIndexState: normalizeTaskIndexState(run.taskIndexState, run.updatedAt ?? timestamp, run.controlState?.updatedBy ?? 'system'),
    executionState: normalizeExecutionState(run.executionState, run.updatedAt ?? timestamp, run.controlState?.updatedBy ?? 'system', tasks),
    artifacts,
    supersededArtifacts,
  }));
};

export const withRunLock = async (runId, operator, action, callback) =>
  withDirectoryLock(`ai/runtime/locks/${runId}.lock`, operator ?? 'system', action, callback, {
    timeoutMs: RUN_LOCK_TIMEOUT_MS,
    staleMs: RUN_LOCK_STALE_MS,
  });

const finalizeWritableRun = (run, operator, previousRun, currentPersistedRun) => {
  let writableRun;

  if (previousRun && operator && operator !== 'system') {
    const previousState = normalizeOrchestrationState(
      previousRun.orchestrationState,
      previousRun.updatedAt ?? nowIso(),
      previousRun.controlState?.updatedBy ?? operator
    );
    const nextState = normalizeOrchestrationState(run.orchestrationState, run.updatedAt ?? nowIso(), run.controlState?.updatedBy ?? operator);
    const isOwnershipTransfer = previousState.primaryOwner !== nextState.primaryOwner;

    if (
      isOwnershipTransfer &&
      (previousState.primaryOwner === operator || previousState.primaryOwner === 'system' || nextState.primaryOwner === operator)
    ) {
      writableRun = {
        ...run,
        orchestrationState: nextState,
      };
    } else {
      writableRun = ensureRunWritableByOperator(run, operator, 'save run state');
    }
  } else {
    writableRun = ensureRunWritableByOperator(run, operator, 'save run state');
  }

  const expectedRevision = typeof previousRun?.revision === 'number' ? previousRun.revision : typeof run.revision === 'number' ? run.revision : 0;
  const currentRevision = typeof currentPersistedRun?.revision === 'number' ? currentPersistedRun.revision : 0;

  if (currentRevision !== expectedRevision) {
    throw new Error(`Run ${run.runId} revision mismatch. Expected ${expectedRevision}, found ${currentRevision}. Reload the run before saving.`);
  }

  const timestamp = nowIso();
  return {
    ...writableRun,
    updatedAt: timestamp,
    revision: nextRevision(currentRevision),
    lockState: {
      ...normalizeLockState(writableRun.lockState, timestamp, operator ?? 'system', writableRun.runId),
      lastHeldBy: operator ?? 'system',
      lastAcquiredAt: timestamp,
      lastReleasedAt: timestamp,
      updatedAt: timestamp,
      updatedBy: operator ?? 'system',
    },
    taskIndexState: normalizeTaskIndexState(writableRun.taskIndexState, timestamp, operator ?? 'system'),
  };
};

export const saveRun = async (run, operator, previousRun, options = {}) => {
  const persistAction = options.action ?? 'save run state';

  if (options.skipLock === true) {
    const currentPersistedRun = options.currentPersistedRun ?? (await readJsonFile(`ai/runtime/runs/${run.runId}.json`).catch(() => null));
    const writableRun = finalizeWritableRun(run, operator, previousRun, currentPersistedRun);
    await assertValidRunState(writableRun);
    await writeJsonFile(`ai/runtime/runs/${writableRun.runId}.json`, writableRun);
    return writableRun;
  }

  return withRunLock(run.runId, operator ?? 'system', persistAction, async () =>
    saveRun(run, operator, previousRun, {
      ...options,
      skipLock: true,
      currentPersistedRun: await readJsonFile(`ai/runtime/runs/${run.runId}.json`).catch(() => null),
    })
  );
};

export const persistRunContext = async ({
  run,
  operator,
  previousRun,
  taskEntries,
  tasks,
  action = 'persist run context',
  validationScope = 'subset',
}) =>
  withRunLock(run.runId, operator ?? 'system', action, async () => {
    const taskIndex = await ensureTaskIndex(run.pipelineId);

    if (Array.isArray(taskEntries) && taskEntries.length > 0) {
      await saveTaskEntries(taskEntries, run.pipelineId, {
        validationScope,
      });
    }

    const nextTaskIndex = Array.isArray(taskEntries) && taskEntries.length > 0 ? await buildTaskIndex(run.pipelineId) : taskIndex;

    let nextRun = {
      ...run,
      taskIndexState: {
        ...normalizeTaskIndexState(run.taskIndexState, run.updatedAt ?? nowIso(), operator ?? 'system'),
        indexHash: nextTaskIndex.indexHash,
        updatedAt: nowIso(),
        updatedBy: operator ?? 'system',
      },
    };
    if (Array.isArray(tasks) && tasks.length > 0) {
      nextRun = await refreshRunState(nextRun, tasks);
    }

    const currentPersistedRun = await readJsonFile(`ai/runtime/runs/${run.runId}.json`).catch(() => null);
    const savedRun = await saveRun(nextRun, operator, previousRun, {
      skipLock: true,
      currentPersistedRun,
      action,
    });

    if (Array.isArray(tasks) && tasks.length > 0) {
      const { nextProjectionState } = await syncProjections(savedRun, tasks, operator ?? 'system');
      if (nextProjectionState) {
        const projectedRun = {
          ...savedRun,
          projectionState: nextProjectionState,
        };
        return saveRun(projectedRun, operator, savedRun, {
          skipLock: true,
          currentPersistedRun: savedRun,
          action: `${action} (projection state)`,
        });
      }
    }

    return savedRun;
  });
