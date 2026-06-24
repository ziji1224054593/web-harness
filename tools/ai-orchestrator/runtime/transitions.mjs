const STARTABLE_TASK_STATUSES = new Set(['ready']);
const COMPLETABLE_TASK_STATUSES = new Set(['running']);
const BLOCKABLE_TASK_STATUSES = new Set(['ready', 'running']);

export const canStartTask = (task, completedTaskIds) => {
  if (!STARTABLE_TASK_STATUSES.has(task.status)) {
    return {
      allowed: false,
      reason: `Task ${task.id} must be ready before it can start.`,
    };
  }

  const missingDependencies = task.dependsOn.filter((dependency) => !completedTaskIds.includes(dependency));
  if (missingDependencies.length > 0) {
    return {
      allowed: false,
      reason: `Task ${task.id} is waiting for dependencies: ${missingDependencies.join(', ')}.`,
    };
  }

  return { allowed: true };
};

export const canCompleteTask = (task, result) => {
  if (!COMPLETABLE_TASK_STATUSES.has(task.status)) {
    return {
      allowed: false,
      reason: `Task ${task.id} must be running before completion.`,
    };
  }

  if (!['done', 'reviewed'].includes(result.status)) {
    return {
      allowed: false,
      reason: `Task ${task.id} completion requires a terminal success status.`,
    };
  }

  if (!Array.isArray(result.evidence) || result.evidence.length === 0) {
    return {
      allowed: false,
      reason: `Task ${task.id} must attach structured evidence before completion.`,
    };
  }

  return { allowed: true };
};

export const canBlockTask = (task, result) => {
  if (!BLOCKABLE_TASK_STATUSES.has(task.status)) {
    return {
      allowed: false,
      reason: `Task ${task.id} must be ready or running before it can be blocked.`,
    };
  }

  if (!['blocked', 'failed'].includes(result.status)) {
    return {
      allowed: false,
      reason: `Task ${task.id} block transition requires blocked or failed status.`,
    };
  }

  return { allowed: true };
};
