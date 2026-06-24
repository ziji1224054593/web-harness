import { validateTaskEntriesAgainstContracts } from './contracts.mjs';
import { normalizeTaskExecutionState } from './run-state.mjs';
import { writeYamlFile } from './store.mjs';
import { canBlockTask, canCompleteTask } from './transitions.mjs';

/**
 * 把调度结果回写到任务定义文件中，保持当前最小实现的单一状态来源。
 */
export const saveTaskEntries = async (taskEntries, pipelineId = 'page-delivery', options = {}) => {
  await validateTaskEntriesAgainstContracts(taskEntries, pipelineId, options);
  await Promise.all(taskEntries.map(({ filePath, task }) => writeYamlFile(filePath, task)));
};

export const applyTaskResult = (task, result, persistedEvidencePaths) => {
  const transitionDecision = result.status === 'blocked' || result.status === 'failed' ? canBlockTask(task, result) : canCompleteTask(task, result);

  if (!transitionDecision.allowed) {
    throw new Error(transitionDecision.reason);
  }

  task.status = result.status;
  task.outputs = result.producedOutputs;
  task.evidenceRefs = result.evidence.map((evidence, index) => ({
    ...evidence,
    path: persistedEvidencePaths[index] ?? evidence.path,
  }));
  const metadata = {
    ...(task.metadata ?? {}),
    lastResultStatus: result.status,
    lastResultSummary: result.summary,
    lastResultNotes: result.notes ?? '',
  };

  if (Array.isArray(result.validationResults) && result.validationResults.length > 0) {
    metadata.lastValidationSuite = result.validationResults.map((item) => item.checkId).join(',');
    metadata.lastValidationSummary = result.validationResults.map((item) => `${item.checkId}:${item.status}`).join(', ');
  }

  task.executionState = undefined;
  task.metadata = metadata;

  return task;
};

export const claimTaskExecution = (task, operator, leaseMs, leaseId, claimedAt) => {
  const normalizedExecutionState = normalizeTaskExecutionState(task.executionState);
  const nextAttempt = normalizedExecutionState?.attempt ? normalizedExecutionState.attempt + 1 : 1;
  const leaseUntil = new Date(new Date(claimedAt).getTime() + leaseMs).toISOString();

  task.status = 'running';
  task.executionState = {
    leaseId,
    claimedBy: operator,
    claimedAt,
    leaseUntil,
    attempt: nextAttempt,
  };
  task.metadata = {
    ...(task.metadata ?? {}),
    lastLeaseId: leaseId,
    lastClaimedBy: operator,
    lastClaimedAt: claimedAt,
  };

  return task;
};

export const releaseTaskExecution = (task) => {
  task.executionState = undefined;
  return task;
};
