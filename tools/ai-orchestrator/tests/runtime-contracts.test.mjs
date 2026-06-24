import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { renderChannelMarkdown } from '../runtime/channel.mjs';
import { validateTaskEntriesAgainstContracts } from '../runtime/contracts.mjs';
import { handoffRunOwnership, takeoverRunOwnership } from '../runtime/control.mjs';
import { formatEventMessage } from '../runtime/notifier.mjs';
import { loadOrCreateRun, refreshRunState, saveRun } from '../runtime/planner.mjs';
import { buildTaskResultFromAgent } from '../runtime/result-parser.mjs';
import {
  canEnterFrontendPhase,
  canEnterQaPhase,
  canReworkAgain,
  isRunDeliverable,
  registerReworkRound,
  requiredGatesForTier,
} from '../runtime/run-policy.mjs';
import { ensureRunWritableByOperator } from '../runtime/run-state.mjs';
import { claimReadyTasks, recoverExpiredClaims } from '../runtime/scheduler.mjs';
import { resolveRepoPath } from '../runtime/store.mjs';
import { resolveRunTaskIds } from '../runtime/task-index.mjs';

const createDemoTask = (overrides = {}) => ({
  id: 'TASK-DEMO',
  title: 'Demo task',
  type: 'implementation',
  ownerRole: 'frontend',
  priority: 'high',
  dependsOn: [],
  inputs: ['src/pages/demo.tsx'],
  outputs: ['src/pages/demo.tsx'],
  acceptance: ['Demo task complete.'],
  gateTargets: ['G4'],
  status: 'ready',
  evidenceRefs: [],
  metadata: {
    feature: 'demo',
  },
  ...overrides,
});

test('validateTaskEntriesAgainstContracts accepts a valid page-delivery chain', async () => {
  const entries = [
    {
      filePath: 'ai/runtime/tasks/TASK-001.yaml',
      task: {
        id: 'TASK-001',
        title: 'Requirement',
        type: 'requirement',
        ownerRole: 'product',
        priority: 'high',
        dependsOn: [],
        inputs: ['ai/tasks/task-backlog.md'],
        outputs: ['ai/docs/prd/demo-prd.md'],
        acceptance: ['Requirement is refined.'],
        gateTargets: ['G1'],
        status: 'done',
        evidenceRefs: [
          {
            evidenceId: 'ev-1',
            kind: 'analysis',
            path: 'ai/runtime/evidence/ev-1.json',
            summary: 'Requirement analyzed.',
            createdAt: '2026-05-09T08:00:00.000Z',
          },
        ],
        metadata: {
          feature: 'demo',
        },
      },
    },
    {
      filePath: 'ai/runtime/tasks/TASK-002.yaml',
      task: {
        id: 'TASK-002',
        title: 'Scan',
        type: 'scan',
        ownerRole: 'architecture',
        priority: 'high',
        dependsOn: ['TASK-001'],
        inputs: ['ai/docs/prd/demo-prd.md'],
        outputs: ['ai/docs/architecture/demo-hld.md'],
        acceptance: ['Architecture boundaries are mapped.'],
        gateTargets: ['G2'],
        status: 'ready',
        evidenceRefs: [],
        metadata: {
          feature: 'demo',
        },
      },
    },
  ];

  await assert.doesNotReject(() => validateTaskEntriesAgainstContracts(entries, 'page-delivery'));
});

test('validateTaskEntriesAgainstContracts rejects role and stage drift', async () => {
  const entries = [
    {
      filePath: 'ai/runtime/tasks/TASK-100.yaml',
      task: {
        id: 'TASK-100',
        title: 'Invalid solution owner',
        type: 'solution',
        ownerRole: 'frontend',
        priority: 'high',
        dependsOn: [],
        inputs: ['ai/docs/prd/demo-prd.md'],
        outputs: ['ai/tasks/task-backlog.md'],
        acceptance: ['Solution is aligned.'],
        gateTargets: ['G3'],
        status: 'ready',
        evidenceRefs: [],
        metadata: {
          feature: 'demo',
        },
      },
    },
  ];

  await assert.rejects(
    () => validateTaskEntriesAgainstContracts(entries, 'page-delivery'),
    /not allowed for role frontend|does not match pipeline stage owner/
  );
});

test('buildTaskResultFromAgent blocks when agent output is not valid json', () => {
  const result = buildTaskResultFromAgent(
    {
      id: 'TASK-900',
      title: 'Broken output',
      type: 'implementation',
      outputs: ['src/pages/demo.tsx'],
    },
    'plain text that is not json'
  );

  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.producedOutputs, []);
  assert.equal(result.evidence.length, 0);
  assert.match(result.notes, /agent_output_parse_failed=true/);
});

test('refreshRunState derives gate states and normalizes artifact pointers', async () => {
  const refreshedRun = await refreshRunState(
    {
      runId: 'RUN-TEST-001',
      pipelineId: 'page-delivery',
      createdAt: '2026-05-13T12:00:00.000Z',
      updatedAt: '2026-05-13T12:00:00.000Z',
      status: 'planning',
      taskIds: ['TASK-001', 'TASK-002'],
      readyQueue: [],
      blockedTasks: [],
      completedTasks: [],
      failedTasks: [],
      gateStateIds: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'],
      gateStates: [],
      controlState: {
        paused: false,
        updatedAt: '2026-05-13T12:00:00.000Z',
        updatedBy: 'tester',
      },
      artifacts: {},
      supersededArtifacts: [],
    },
    [
      {
        id: 'TASK-001',
        title: 'Requirement',
        type: 'requirement',
        ownerRole: 'product',
        priority: 'high',
        dependsOn: [],
        inputs: ['ai/docs/prd/demo-prd.md'],
        outputs: ['ai/docs/prd/demo-prd.md'],
        acceptance: ['Requirement is refined.'],
        gateTargets: ['G1'],
        status: 'done',
        evidenceRefs: [
          {
            evidenceId: 'ev-1',
            kind: 'analysis',
            path: 'ai/runtime/evidence/ev-1.json',
            summary: 'Requirement analyzed.',
            createdAt: '2026-05-13T12:00:00.000Z',
          },
        ],
        metadata: {
          feature: 'demo',
        },
      },
      {
        id: 'TASK-002',
        title: 'Scan',
        type: 'scan',
        ownerRole: 'architecture',
        priority: 'high',
        dependsOn: ['TASK-001'],
        inputs: ['ai/docs/prd/demo-prd.md'],
        outputs: ['ai/docs/architecture/demo-hld.md'],
        acceptance: ['Architecture boundaries are mapped.'],
        gateTargets: ['G2'],
        status: 'ready',
        evidenceRefs: [],
        metadata: {
          feature: 'demo',
        },
      },
    ]
  );

  assert.equal(refreshedRun.gateStates.find((gate) => gate.gateId === 'G1')?.status, 'passed');
  assert.equal(refreshedRun.gateStates.find((gate) => gate.gateId === 'G2')?.status, 'in_progress');
  assert.equal(refreshedRun.artifacts.current_frontend_handoff.status, 'missing');
  assert.equal(refreshedRun.orchestrationState.primaryOwner, 'tester');
  assert.equal(refreshedRun.orchestrationState.mode, 'single_writer_run');
  assert.equal(refreshedRun.status, 'running');
});

test('ensureRunWritableByOperator claims unowned runs and blocks foreign writers', () => {
  const claimedRun = ensureRunWritableByOperator(
    {
      runId: 'RUN-TEST-OWNERSHIP',
      updatedAt: '2026-05-13T12:00:00.000Z',
      controlState: {
        paused: false,
        updatedAt: '2026-05-13T12:00:00.000Z',
        updatedBy: 'system',
      },
      orchestrationState: {
        mode: 'single_writer_run',
        primaryOwner: 'system',
        ownerRole: 'lead_orchestrator',
        coordinationStatus: 'clear',
        updatedAt: '2026-05-13T12:00:00.000Z',
        updatedBy: 'system',
      },
    },
    'lead-a',
    'claim run state'
  );

  assert.equal(claimedRun.orchestrationState.primaryOwner, 'lead-a');
  assert.throws(
    () =>
      ensureRunWritableByOperator(
        {
          ...claimedRun,
          orchestrationState: {
            ...claimedRun.orchestrationState,
            primaryOwner: 'lead-a',
          },
        },
        'lead-b',
        'save run state'
      ),
    /currently owned by lead-a/
  );
});

test('handoffRunOwnership transfers primary owner only from current owner', () => {
  const baseRun = {
    runId: 'RUN-TEST-HANDOFF',
    updatedAt: '2026-05-13T12:00:00.000Z',
    controlState: {
      paused: false,
      updatedAt: '2026-05-13T12:00:00.000Z',
      updatedBy: 'lead-a',
    },
    orchestrationState: {
      mode: 'single_writer_run',
      primaryOwner: 'lead-a',
      ownerRole: 'lead_orchestrator',
      coordinationStatus: 'clear',
      updatedAt: '2026-05-13T12:00:00.000Z',
      updatedBy: 'lead-a',
    },
  };

  const handedOffRun = handoffRunOwnership(baseRun, 'lead-a', 'lead-b', 'handoff after convergence', {
    currentStageId: 'frontend',
    note: 'Lead B takes implementation orchestration.',
  });

  assert.equal(handedOffRun.orchestrationState.primaryOwner, 'lead-b');
  assert.equal(handedOffRun.orchestrationState.currentStageId, 'frontend');
  assert.equal(handedOffRun.orchestrationState.note, 'Lead B takes implementation orchestration.');

  assert.throws(() => handoffRunOwnership(baseRun, 'lead-c', 'lead-d', 'invalid handoff'), /Only the current primary orchestrator can hand it off/);
});

test('takeoverRunOwnership assigns primary owner to operator', () => {
  const takenOverRun = takeoverRunOwnership(
    {
      runId: 'RUN-TEST-TAKEOVER',
      updatedAt: '2026-05-13T12:00:00.000Z',
      controlState: {
        paused: false,
        updatedAt: '2026-05-13T12:00:00.000Z',
        updatedBy: 'lead-a',
      },
      orchestrationState: {
        mode: 'single_writer_run',
        primaryOwner: 'lead-a',
        ownerRole: 'lead_orchestrator',
        coordinationStatus: 'clear',
        updatedAt: '2026-05-13T12:00:00.000Z',
        updatedBy: 'lead-a',
      },
    },
    'lead-b',
    'manual takeover approved',
    {
      coordinationStatus: 'watch',
      note: 'Ownership changed during active run.',
    }
  );

  assert.equal(takenOverRun.orchestrationState.primaryOwner, 'lead-b');
  assert.equal(takenOverRun.orchestrationState.coordinationStatus, 'watch');
  assert.equal(takenOverRun.orchestrationState.note, 'Ownership changed during active run.');
});

test('claimReadyTasks creates leases and recoverExpiredClaims returns expired tasks to ready', () => {
  const run = {
    completedTasks: [],
    readyQueue: ['TASK-READY'],
  };
  const tasks = [
    createDemoTask({
      id: 'TASK-READY',
      status: 'ready',
    }),
  ];

  const claimedTasks = claimReadyTasks(run, tasks, 'worker-a', 1, 1000, '2026-05-14T00:00:00.000Z');

  assert.equal(claimedTasks.length, 1);
  assert.equal(tasks[0].status, 'running');
  assert.equal(tasks[0].executionState.claimedBy, 'worker-a');

  recoverExpiredClaims(tasks, new Date('2026-05-14T00:10:00.000Z'));
  assert.equal(tasks[0].status, 'ready');
  assert.equal(tasks[0].executionState, undefined);
});

test('resolveRunTaskIds includes dependency closure from task index', () => {
  const resolvedTaskIds = resolveRunTaskIds(
    {
      taskIds: ['TASK-003'],
    },
    {
      tasks: {
        'TASK-001': {
          dependsOn: [],
        },
        'TASK-002': {
          dependsOn: ['TASK-001'],
        },
        'TASK-003': {
          dependsOn: ['TASK-002'],
        },
      },
    }
  );

  assert.deepEqual(resolvedTaskIds.sort(), ['TASK-001', 'TASK-002', 'TASK-003']);
});

test('requiredGatesForTier skips G3/G6 for light and keeps all for standard/full', () => {
  assert.deepEqual(requiredGatesForTier('light'), ['G1', 'G2', 'G4', 'G5']);
  assert.deepEqual(requiredGatesForTier('standard'), ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
  assert.deepEqual(requiredGatesForTier('full'), ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
  // unknown tier falls back to standard
  assert.deepEqual(requiredGatesForTier('???'), ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
});

test('isRunDeliverable respects tier-specific required gates', () => {
  const gateStates = [
    { gateId: 'G1', status: 'passed' },
    { gateId: 'G2', status: 'passed' },
    { gateId: 'G3', status: 'todo' },
    { gateId: 'G4', status: 'passed' },
    { gateId: 'G5', status: 'passed' },
    { gateId: 'G6', status: 'todo' },
  ];
  // light skips G3/G6 -> deliverable even though they are not passed
  assert.equal(isRunDeliverable({ gateStates }, 'light').deliverable, true);
  // full requires G3/G6 -> blocked
  const fullVerdict = isRunDeliverable({ gateStates }, 'full');
  assert.equal(fullVerdict.deliverable, false);
  assert.deepEqual(fullVerdict.blockingGates, ['G3', 'G6']);
});

test('phase gates require confirmed upstream artifacts (standard/full) and relax for light', () => {
  const runMissingUx = { tier: 'full', artifacts: { current_ux_interaction: { status: 'missing' } } };
  assert.equal(canEnterFrontendPhase(runMissingUx).allowed, false);

  const runWithUx = { tier: 'full', artifacts: { current_ux_interaction: { status: 'current', path: 'x.md' } } };
  assert.equal(canEnterFrontendPhase(runWithUx).allowed, true);

  // light tier skips UX, so Frontend may proceed without the UX artifact
  assert.equal(canEnterFrontendPhase({ tier: 'light', artifacts: {} }).allowed, true);

  assert.equal(canEnterQaPhase({ artifacts: { current_frontend_handoff: { status: 'missing' } } }).allowed, false);
  assert.equal(canEnterQaPhase({ artifacts: { current_frontend_handoff: { status: 'current', path: 'h.md' } } }).allowed, true);
});

test('rework circuit breaker trips after maxRounds and blocks further rework', () => {
  let state = { rounds: 0, maxRounds: 2, tripped: false, updatedAt: '2026-06-23T00:00:00.000Z', updatedBy: 'lead' };
  assert.equal(canReworkAgain(state).allowed, true);

  state = registerReworkRound(state, 'round 1', 'lead');
  assert.equal(state.rounds, 1);
  assert.equal(state.tripped, false);

  state = registerReworkRound(state, 'round 2', 'lead');
  assert.equal(state.rounds, 2);
  assert.equal(state.tripped, true);

  assert.equal(canReworkAgain(state).allowed, false);
  assert.throws(() => registerReworkRound(state, 'round 3', 'lead'), /circuit breaker tripped/);
});

test('formatEventMessage renders channel messages and lifecycle events, skips noise', () => {
  const dispatch = formatEventMessage({
    eventName: 'channel.message',
    taskId: 'FE-001',
    payload: { from: 'product', to: 'frontend', kind: 'dispatch', text: '登录页交给前端' },
  });
  assert.match(dispatch, /product→派发任务/);
  assert.match(dispatch, /@frontend/);
  assert.match(dispatch, /FE-001/);
  assert.match(dispatch, /登录页交给前端/);

  assert.match(formatEventMessage({ eventName: 'gate.updated', payload: { gateId: 'G4', status: 'passed' } }), /G4 → passed/);
  // non-notify event types are skipped
  assert.equal(formatEventMessage({ eventName: 'task.started', payload: {} }), null);
});

test('renderChannelMarkdown builds a conversation table and an empty state', () => {
  const empty = renderChannelMarkdown('RUN-X', []);
  assert.match(empty, /任务对接群/);
  assert.match(empty, /群内暂无消息/);

  const withMsgs = renderChannelMarkdown('RUN-X', [
    {
      occurredAt: '2026-06-23T01:02:03.000Z',
      eventName: 'channel.message',
      taskId: 'FE-001',
      payload: { from: 'frontend', to: 'qa', kind: 'done', text: '完成' },
    },
    { occurredAt: '2026-06-23T01:00:00.000Z', eventName: 'task.started', payload: {} },
  ]);
  assert.match(withMsgs, /frontend→完成并交接/);
  // the task.started row is filtered out (not a notify event)
  assert.equal(withMsgs.split('\n').filter((l) => l.startsWith('| 2026')).length, 1);
});

test('saveRun increments revision and rejects stale writes', async () => {
  const runId = `RUN-TEST-CAS-${Date.now()}`;
  const runFilePath = resolveRepoPath(`ai/runtime/runs/${runId}.json`);

  try {
    const initialRun = await loadOrCreateRun(runId, 'page-delivery', [createDemoTask()]);
    const firstSavedRun = await saveRun(initialRun, 'tester');
    assert.equal(firstSavedRun.revision, 1);

    await assert.rejects(
      () =>
        saveRun(
          {
            ...initialRun,
            status: 'blocked',
          },
          'tester',
          initialRun
        ),
      /revision mismatch/
    );
  } finally {
    await rm(runFilePath, { force: true });
  }
});
