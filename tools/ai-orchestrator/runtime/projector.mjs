import { createHash } from 'node:crypto';

import { GATE_DESCRIPTIONS } from './constants.mjs';
import { assertValidProjectionBundle } from './contracts.mjs';
import { appendRunEvent, readOperatorActions } from './events.mjs';
import { renderBacklogMarkdown, renderCurrentArtifactsMarkdown, renderGateMarkdown, renderReportMarkdown } from './markdown-writer.mjs';
import { normalizeProjectionState } from './run-state.mjs';
import { writeJsonFile, writeTextFile } from './store.mjs';

const nowIso = () => new Date().toISOString();
const computeHash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');

export const syncProjections = async (run, tasks, operator = 'system') => {
  const generatedAt = nowIso();
  const recentOperatorActions = await readOperatorActions(run.runId, 5);
  const currentProjectionState = normalizeProjectionState(run.projectionState, run.updatedAt, operator);

  const backlog = {
    generatedAt,
    items: tasks.map((task) => ({
      taskId: task.id,
      feature: task.metadata?.feature ?? task.title,
      owner: task.ownerRole,
      status: task.status,
      inputs: task.inputs,
      outputs: task.outputs,
      notes: [
        task.acceptance.join(' / '),
        task.metadata?.lastResultNotes,
        task.metadata?.approvalStatus ? `approval=${task.metadata.approvalStatus}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
    })),
  };

  const gates = {
    generatedAt,
    items: (run.gateStates ?? []).map((gate) => ({
      gateId: gate.gateId,
      description: GATE_DESCRIPTIONS[gate.gateId] ?? gate.gateId,
      status: gate.status,
      evidence: gate.evidenceRefs,
      notes: gate.note ?? '',
    })),
  };

  const currentArtifacts = {
    generatedAt,
    runId: run.runId,
    runStatus: run.status,
    orchestrationState: run.orchestrationState,
    artifacts: run.artifacts,
    supersededArtifacts: run.supersededArtifacts ?? [],
  };

  const report = {
    generatedAt,
    runId: run.runId,
    summary: `Run status: ${run.status}. Completed ${run.completedTasks.length}/${tasks.length} tasks.`,
    sections: [
      {
        title: 'Control State',
        entries: [
          `paused=${run.controlState?.paused === true}`,
          `updatedBy=${run.controlState?.updatedBy ?? 'system'}`,
          `reason=${run.controlState?.reason ?? ''}`,
          `primaryOwner=${run.orchestrationState?.primaryOwner ?? 'system'}`,
          `ownerRole=${run.orchestrationState?.ownerRole ?? 'lead_orchestrator'}`,
          `coordinationStatus=${run.orchestrationState?.coordinationStatus ?? 'clear'}`,
          `currentStageId=${run.orchestrationState?.currentStageId ?? ''}`,
        ],
      },
      {
        title: 'Task Progress',
        entries: tasks.map(
          (task) =>
            `${task.id} [${task.ownerRole}] => ${task.status} (${task.title})${
              task.metadata?.lastResultSummary ? ` :: ${task.metadata.lastResultSummary}` : ''
            }${task.metadata?.approvalStatus ? ` :: approval=${task.metadata.approvalStatus}` : ''}`
        ),
      },
      {
        title: 'Gate Status',
        entries: gates.items.map((gate) => `${gate.gateId} => ${gate.status}`),
      },
      {
        title: 'Current Artifacts',
        entries: Object.entries(run.artifacts ?? {}).map(
          ([key, artifact]) =>
            `${key} => ${artifact.status}${artifact.path ? ` :: ${artifact.path}` : ''}${artifact.note ? ` :: ${artifact.note}` : ''}`
        ),
      },
      {
        title: 'Recent Operator Actions',
        entries:
          recentOperatorActions.length > 0
            ? recentOperatorActions.map((record) => `${record.occurredAt} [${record.operator}] ${record.action} :: ${record.reason}`)
            : ['No operator actions recorded.'],
      },
    ],
  };

  await assertValidProjectionBundle({
    generatedAt,
    backlog,
    gates,
    report,
    currentArtifacts,
  });

  const backlogMarkdown = renderBacklogMarkdown(backlog);
  const gatesMarkdown = renderGateMarkdown(gates);
  const reportMarkdown = renderReportMarkdown(report);
  const currentArtifactsMarkdown = renderCurrentArtifactsMarkdown(currentArtifacts);

  const nextProjectionState = {
    ...currentProjectionState,
    inputHash: computeHash({
      runId: run.runId,
      revision: run.revision,
      taskIds: tasks.map((task) => `${task.id}:${task.status}:${task.executionState?.leaseId ?? ''}`),
      artifactPointers: run.artifacts,
    }),
    backlogHash: computeHash(backlog.items),
    gatesHash: computeHash(gates.items),
    reportHash: computeHash({
      runId: report.runId,
      summary: report.summary,
      sections: report.sections,
    }),
    currentArtifactsHash: computeHash({
      runId: currentArtifacts.runId,
      runStatus: currentArtifacts.runStatus,
      orchestrationState: currentArtifacts.orchestrationState,
      artifacts: currentArtifacts.artifacts,
      supersededArtifacts: currentArtifacts.supersededArtifacts,
    }),
    updatedAt: generatedAt,
    updatedBy: operator,
  };

  const changedBacklog = nextProjectionState.backlogHash !== currentProjectionState.backlogHash;
  const changedGates = nextProjectionState.gatesHash !== currentProjectionState.gatesHash;
  const changedReport = nextProjectionState.reportHash !== currentProjectionState.reportHash;
  const changedCurrentArtifacts = nextProjectionState.currentArtifactsHash !== currentProjectionState.currentArtifactsHash;

  if (changedBacklog) {
    await writeJsonFile('ai/runtime/projections/backlog.json', backlog);
    await writeJsonFile(`ai/runtime/projections/runs/${run.runId}/backlog.json`, backlog);
    await writeTextFile('ai/tasks/task-backlog.md', backlogMarkdown);
    await writeTextFile(`ai/tasks/runs/${run.runId}-task-backlog.md`, backlogMarkdown);
  }

  if (changedGates) {
    await writeJsonFile('ai/runtime/projections/gates.json', gates);
    await writeJsonFile(`ai/runtime/projections/runs/${run.runId}/gates.json`, gates);
    await writeTextFile('ai/checklists/gate-status.md', gatesMarkdown);
    await writeTextFile(`ai/checklists/runs/${run.runId}-gate-status.md`, gatesMarkdown);
  }

  if (changedReport) {
    await writeJsonFile('ai/runtime/projections/report.json', report);
    await writeJsonFile(`ai/runtime/projections/runs/${run.runId}/report.json`, report);
    await writeTextFile('ai/reports/change-log.md', reportMarkdown);
    await writeTextFile(`ai/reports/runs/${run.runId}-change-log.md`, reportMarkdown);
  }

  if (changedCurrentArtifacts) {
    await writeJsonFile('ai/runtime/projections/current-artifacts.json', currentArtifacts);
    await writeJsonFile(`ai/runtime/projections/runs/${run.runId}/current-artifacts.json`, currentArtifacts);
    await writeTextFile(`ai/context/runs/${run.runId}/current-artifacts.md`, currentArtifactsMarkdown);
  }

  if (changedGates) {
    for (const gate of gates.items) {
      await appendRunEvent(
        run.runId,
        'gate.updated',
        {
          gateId: gate.gateId,
          status: gate.status,
          evidenceRefs: gate.evidence,
        },
        undefined
      );
    }
  }

  if (changedReport) {
    await appendRunEvent(
      run.runId,
      'report.generated',
      {
        status: run.status,
        summary: report.summary,
      },
      undefined
    );
  }

  return { backlog, gates, report, currentArtifacts, nextProjectionState };
};
