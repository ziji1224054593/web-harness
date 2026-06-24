import { writeOverview, writeRunBoard } from '../runtime/board-writer.mjs';
import { parseCliArgs } from '../runtime/cli.mjs';
import { loadRoleRegistry } from '../runtime/contracts.mjs';
import { dispatchTask } from '../runtime/dispatcher.mjs';
import { appendRunEvent } from '../runtime/events.mjs';
import { persistTaskEvidence } from '../runtime/evidence.mjs';
import { loadOrCreateRun, loadRunTaskEntries, refreshRunState, saveRun, withRunLock } from '../runtime/planner.mjs';
import { loadProjectContract } from '../runtime/project-contract.mjs';
import { syncProjections } from '../runtime/projector.mjs';
import { canEnterFrontendPhase, canEnterQaPhase } from '../runtime/run-policy.mjs';
import { DEFAULT_WORKER_LEASE_MS, normalizeTaskExecutionState } from '../runtime/run-state.mjs';
import { claimReadyTasks, recoverExpiredClaims, unlockDependentTasks } from '../runtime/scheduler.mjs';
import { applyTaskResult, releaseTaskExecution, saveTaskEntries } from '../runtime/task-state.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const workerId = options.by ?? `worker-${process.pid}`;
const concurrency = Math.max(1, Number.parseInt(options.concurrency ?? '1', 10));
const leaseMs = Math.max(1000, Number.parseInt(options['lease-ms'] ?? String(DEFAULT_WORKER_LEASE_MS), 10));

// 中文注释：run 命令会把 ready 任务交给真实 Agent adapter；若环境缺失则结构化阻断。
const roleRegistry = await loadRoleRegistry();
const projectContract = await loadProjectContract();

const commitLockedRunState = async (runSnapshot, previousRun, taskEntries, tasks, action) => {
  const runWriter = runSnapshot.orchestrationState?.primaryOwner ?? workerId;
  await saveTaskEntries(taskEntries, runSnapshot.pipelineId, {
    validationScope: 'subset',
  });
  const savedRun = await saveRun(runSnapshot, runWriter, previousRun, {
    skipLock: true,
    currentPersistedRun: previousRun,
    action,
  });
  const { nextProjectionState } = await syncProjections(savedRun, tasks, runWriter);
  return saveRun(
    {
      ...savedRun,
      projectionState: nextProjectionState,
    },
    runWriter,
    savedRun,
    {
      skipLock: true,
      currentPersistedRun: savedRun,
      action: `${action} (projection state)`,
    }
  );
};

const claimResult = await withRunLock(runId, workerId, 'claim ready tasks', async () => {
  const latestRun = await loadOrCreateRun(runId);
  const taskEntries = await loadRunTaskEntries(latestRun);
  const tasks = taskEntries.map((entry) => entry.task);

  recoverExpiredClaims(tasks);
  unlockDependentTasks(tasks);

  const refreshedRun = await refreshRunState(latestRun, tasks);

  if (refreshedRun.controlState?.paused === true) {
    const savedRun = await commitLockedRunState(refreshedRun, latestRun, taskEntries, tasks, 'respect paused run state');
    return {
      run: savedRun,
      claimedEntries: [],
      paused: true,
    };
  }

  const claimedEntries = claimReadyTasks(refreshedRun, tasks, workerId, concurrency, leaseMs).map((task) =>
    taskEntries.find((entry) => entry.task.id === task.id)
  );
  const runAfterClaim = await refreshRunState(refreshedRun, tasks);
  const savedRun = await commitLockedRunState(runAfterClaim, latestRun, taskEntries, tasks, 'claim ready tasks');

  for (const entry of claimedEntries.filter(Boolean)) {
    await appendRunEvent(
      savedRun.runId,
      'task.started',
      {
        status: 'running',
        leaseId: entry.task.executionState?.leaseId,
        claimedBy: workerId,
      },
      entry.task.id
    );
  }

  return {
    run: savedRun,
    claimedEntries: claimedEntries.filter(Boolean),
    paused: false,
  };
});

if (claimResult.paused) {
  console.log(
    `Run ${claimResult.run.runId} is paused by ${claimResult.run.controlState.updatedBy}. Reason: ${claimResult.run.controlState.reason ?? 'n/a'}`
  );
  process.exit(0);
}

if (claimResult.claimedEntries.length === 0) {
  console.log(`Run ${claimResult.run.runId} has no claimable ready tasks.`);
  process.exit(0);
}

// 阶段门禁（工具级强制）：进入 Frontend / QA 阶段前必须满足 artifact 前置条件。
// 未满足时不分发，直接产出结构化 blocked 结果（与缺失 adapter 的处理一致），由既有 commit 链路落盘。
const evaluatePhaseGate = (task, run) => {
  if (task.type === 'implementation') return canEnterFrontendPhase(run, run.tier);
  if (task.type === 'validation') return canEnterQaPhase(run);
  return { allowed: true };
};

const executionResults = await Promise.all(
  claimResult.claimedEntries.map(async (entry) => {
    const task = entry.task;
    const phaseGate = evaluatePhaseGate(task, claimResult.run);
    const result = phaseGate.allowed
      ? await dispatchTask(task, roleRegistry, claimResult.run, projectContract)
      : {
          status: 'blocked',
          summary: `Phase gate blocked task ${task.id}.`,
          notes: `phase_gate_blocked=true; ${phaseGate.reason}`,
          producedOutputs: [],
          evidence: [],
        };
    const persistedEvidencePaths = await persistTaskEvidence(claimResult.run.runId, task, result);

    return {
      taskId: task.id,
      leaseId: task.executionState?.leaseId,
      result,
      persistedEvidencePaths,
    };
  })
);

for (const executionResult of executionResults) {
  await withRunLock(runId, workerId, `commit task ${executionResult.taskId}`, async () => {
    const latestRun = await loadOrCreateRun(runId);
    const taskEntries = await loadRunTaskEntries(latestRun);
    const tasks = taskEntries.map((entry) => entry.task);
    const targetEntry = taskEntries.find((entry) => entry.task.id === executionResult.taskId);

    if (!targetEntry) {
      throw new Error(`Cannot commit task ${executionResult.taskId}; task entry no longer exists.`);
    }

    const currentExecutionState = normalizeTaskExecutionState(targetEntry.task.executionState);
    if (!currentExecutionState || currentExecutionState.claimedBy !== workerId || currentExecutionState.leaseId !== executionResult.leaseId) {
      throw new Error(`Cannot commit task ${executionResult.taskId}; current lease no longer belongs to ${workerId}.`);
    }

    applyTaskResult(targetEntry.task, executionResult.result, executionResult.persistedEvidencePaths);
    releaseTaskExecution(targetEntry.task);
    const previousReadyQueue = [...latestRun.readyQueue];
    unlockDependentTasks(tasks);
    const refreshedRun = await refreshRunState(latestRun, tasks);
    const savedRun = await commitLockedRunState(refreshedRun, latestRun, taskEntries, tasks, `commit task ${executionResult.taskId}`);

    await appendRunEvent(
      savedRun.runId,
      executionResult.result.status === 'blocked' || executionResult.result.status === 'failed' ? 'task.blocked' : 'task.completed',
      executionResult.result.status === 'blocked' || executionResult.result.status === 'failed'
        ? {
            status: executionResult.result.status,
            reason: executionResult.result.notes ?? executionResult.result.summary,
          }
        : {
            status: executionResult.result.status,
            evidence: targetEntry.task.evidenceRefs,
          },
      targetEntry.task.id
    );

    for (const task of tasks.filter((task) => task.status === 'ready' && !previousReadyQueue.includes(task.id))) {
      await appendRunEvent(
        savedRun.runId,
        'task.ready',
        {
          status: 'ready',
        },
        task.id
      );
    }
  });
}

const finalRun = await loadOrCreateRun(runId);
console.log(`Executed run ${finalRun.runId} as ${workerId}. Completed tasks: ${finalRun.completedTasks.join(', ') || 'none'}`);

// 跑完自动重渲看板与总览(best-effort：渲染失败只告警，不影响 run 结果)。
try {
  const board = await writeRunBoard(runId);
  await writeOverview();
  console.log(`Board refreshed -> ${board.path}`);
} catch (error) {
  console.warn(`[board][warn] 看板自动重渲失败(已忽略): ${error.message}`);
}
