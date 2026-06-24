/**
 * 第三批审批层：把人工决策和任务恢复拆开，避免“批准即执行”的隐式副作用。
 */

const nowIso = () => new Date().toISOString();

export const markTaskApproved = (task, operator, reason) => {
  task.metadata = {
    ...(task.metadata ?? {}),
    approvalStatus: 'approved',
    approvalReason: reason,
    approvalBy: operator,
    approvalAt: nowIso(),
    recoveryEligible: 'true',
  };

  return task;
};

export const markTaskRejected = (task, operator, reason) => {
  task.status = 'blocked';
  task.metadata = {
    ...(task.metadata ?? {}),
    approvalStatus: 'rejected',
    approvalReason: reason,
    approvalBy: operator,
    approvalAt: nowIso(),
    recoveryEligible: 'false',
    lastResultStatus: 'blocked',
    lastResultSummary: `Task ${task.id} was rejected by operator.`,
    lastResultNotes: reason,
  };

  return task;
};

export const recoverApprovedTask = (task, operator, reason) => {
  task.status = 'ready';
  task.metadata = {
    ...(task.metadata ?? {}),
    recoveryEligible: 'false',
    lastOperatorAction: 'recover',
    lastOperatorReason: reason,
    recoveredBy: operator,
    recoveredAt: nowIso(),
    lastResultStatus: 'ready',
    lastResultSummary: `Task ${task.id} was recovered by operator.`,
    lastResultNotes: reason,
  };

  return task;
};

export const isTaskRecoveryApproved = (task) => task.metadata?.approvalStatus === 'approved';
