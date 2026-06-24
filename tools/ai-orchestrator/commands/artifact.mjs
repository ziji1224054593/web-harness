import { parseCliArgs } from '../runtime/cli.mjs';
import { appendOperatorAction } from '../runtime/events.mjs';
import { loadOrCreateRun, loadRunTasks, persistRunContext, refreshRunState } from '../runtime/planner.mjs';
import { RUN_ARTIFACT_KEYS, createEmptyArtifactEntry } from '../runtime/run-state.mjs';

const options = parseCliArgs(process.argv.slice(2));
const runId = options.run ?? 'RUN-SAMPLE-001';
const operatorArg = options.by;
const artifactKey = options.key;
const artifactPath = options.path;
const note = options.note ?? '';
const clear = options.clear === 'true';
const supersededPath = options['superseded-path'];
const supersededNote = options['superseded-note'] ?? '';
const replacedBy = options['replaced-by'];

if (!artifactKey && !supersededPath) {
  throw new Error('artifact 命令至少需要提供 --key 或 --superseded-path。');
}

if (artifactKey && !RUN_ARTIFACT_KEYS.includes(artifactKey)) {
  throw new Error(`未知 artifact key: ${artifactKey}`);
}

if (artifactKey && !clear && !artifactPath) {
  throw new Error('更新当前 artifact 时必须提供 --path，或使用 --clear true 清空。');
}

const run = await loadOrCreateRun(runId);
const operator = operatorArg ?? run.orchestrationState?.primaryOwner ?? 'manual';
const tasks = await loadRunTasks(run);
const refreshedRun = await refreshRunState(run, tasks);
const timestamp = new Date().toISOString();

if (artifactKey) {
  refreshedRun.artifacts[artifactKey] = clear
    ? {
        ...createEmptyArtifactEntry(timestamp, operator),
        ...(note ? { note } : {}),
      }
    : {
        status: 'current',
        path: artifactPath,
        ...(note ? { note } : {}),
        updatedAt: timestamp,
        updatedBy: operator,
      };
}

if (supersededPath) {
  refreshedRun.supersededArtifacts = [
    ...(refreshedRun.supersededArtifacts ?? []).filter((item) => item.path !== supersededPath),
    {
      path: supersededPath,
      ...(supersededNote ? { note: supersededNote } : {}),
      ...(replacedBy ? { replacedBy } : {}),
      updatedAt: timestamp,
      updatedBy: operator,
    },
  ];
}

refreshedRun.updatedAt = timestamp;
const savedRun = await persistRunContext({
  run: refreshedRun,
  operator,
  previousRun: run,
  tasks,
  action: 'update run artifacts',
});
await appendOperatorAction(savedRun.runId, 'artifact.update', operator, note || 'Updated run artifacts', {
  artifactKey,
  artifactPath,
  supersededPath,
});

console.log(`Updated artifacts for run ${savedRun.runId}.`);
