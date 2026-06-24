import { TASK_SUCCESS_STATUSES } from './constants.mjs';
import { DEFAULT_WORKER_LEASE_MS, normalizeTaskExecutionState } from './run-state.mjs';
import { claimTaskExecution, releaseTaskExecution } from './task-state.mjs';

const nowIso = () => new Date().toISOString();

export const isLeaseExpired = (task, referenceTime = new Date()) => {
  const executionState = normalizeTaskExecutionState(task.executionState);
  if (!executionState) return false;
  return new Date(executionState.leaseUntil).getTime() <= referenceTime.getTime();
};

/**
 * 只挑选当前 run 中真正可执行的 ready 任务。
 */
export const getReadyTasks = (run, tasks, referenceTime = new Date()) => {
  const completedTaskIds = new Set(run.completedTasks);

  return tasks.filter(
    (task) =>
      run.readyQueue.includes(task.id) &&
      task.status === 'ready' &&
      !normalizeTaskExecutionState(task.executionState) &&
      task.dependsOn.every((dependencyId) => completedTaskIds.has(dependencyId)) &&
      !isLeaseExpired(task, referenceTime)
  );
};

/**
 * 当上游任务完成后，把满足依赖的新任务推进到 ready。
 */
export const unlockDependentTasks = (tasks) => {
  const completedTaskIds = new Set(tasks.filter((task) => TASK_SUCCESS_STATUSES.has(task.status)).map((task) => task.id));

  for (const task of tasks) {
    if (task.status !== 'todo') continue;

    const dependenciesSatisfied = task.dependsOn.every((dependencyId) => completedTaskIds.has(dependencyId));

    if (dependenciesSatisfied) {
      task.status = 'ready';
    }
  }

  return tasks;
};

export const recoverExpiredClaims = (tasks, referenceTime = new Date()) => {
  for (const task of tasks) {
    if (task.status !== 'running') continue;
    if (!isLeaseExpired(task, referenceTime)) continue;
    releaseTaskExecution(task);
    task.status = 'ready';
    task.metadata = {
      ...(task.metadata ?? {}),
      lastLeaseRecoveredAt: referenceTime.toISOString(),
    };
  }

  return tasks;
};

export const claimReadyTasks = (run, tasks, operator, limit = 1, leaseMs = DEFAULT_WORKER_LEASE_MS, claimedAt = nowIso()) => {
  const readyTasks = getReadyTasks(run, tasks, new Date(claimedAt)).slice(0, limit);

  for (const [index, task] of readyTasks.entries()) {
    claimTaskExecution(task, operator, leaseMs, `${task.id}-${operator}-${Date.now()}-${index}`, claimedAt);
  }

  return readyTasks;
};
