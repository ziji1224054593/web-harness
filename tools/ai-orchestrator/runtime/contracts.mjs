import { assertValidBySchema } from './schema-validator.mjs';
import { readYamlFile } from './store.mjs';

const SUCCESS_STATUSES = new Set(['done', 'reviewed']);

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const unique = (items) => [...new Set(items)];

export const loadRoleRegistry = async () => {
  const registry = await readYamlFile('ai/runtime/definitions/roles.yaml');

  if (!registry?.roles || typeof registry.roles !== 'object') {
    throw new Error('ai/runtime/definitions/roles.yaml must define a roles object.');
  }

  return registry;
};

export const loadPipelineDefinition = async (pipelineId = 'page-delivery') => {
  const registry = await readYamlFile('ai/runtime/definitions/pipelines.yaml');
  const pipeline = registry?.pipelines?.[pipelineId];

  if (!pipeline) {
    throw new Error(`Pipeline ${pipelineId} is not defined in ai/runtime/definitions/pipelines.yaml.`);
  }

  if (!Array.isArray(pipeline.stages) || pipeline.stages.length === 0) {
    throw new Error(`Pipeline ${pipelineId} must define at least one stage.`);
  }

  return pipeline;
};

export const buildPipelineIndex = (pipeline) => {
  const stageByTaskType = new Map();
  const stageById = new Map();

  pipeline.stages.forEach((stage, index) => {
    if (stageByTaskType.has(stage.taskType)) {
      throw new Error(`Pipeline stage taskType must be unique. Duplicate found: ${stage.taskType}`);
    }

    stageByTaskType.set(stage.taskType, { ...stage, index });
    stageById.set(stage.stageId, { ...stage, index });
  });

  return {
    stageByTaskType,
    stageById,
  };
};

const validateTaskContract = (task, tasksById, roleRegistry, pipelineIndex, errors) => {
  const roleConfig = roleRegistry.roles?.[task.ownerRole];
  if (!roleConfig) {
    errors.push(`Task ${task.id} references unknown ownerRole ${task.ownerRole}.`);
    return;
  }

  const allowedTaskTypes = ensureArray(roleConfig.allowedTaskTypes);
  if (!allowedTaskTypes.includes(task.type)) {
    errors.push(`Task ${task.id} uses type ${task.type} which is not allowed for role ${task.ownerRole}.`);
  }

  const stage = pipelineIndex.stageByTaskType.get(task.type);
  if (!stage) {
    errors.push(`Task ${task.id} uses type ${task.type} which is not staged in the active pipeline.`);
    return;
  }

  if (stage.ownerRole !== task.ownerRole) {
    errors.push(`Task ${task.id} ownerRole ${task.ownerRole} does not match pipeline stage owner ${stage.ownerRole} for type ${task.type}.`);
  }

  if (task.gateTargets.length !== 1 || task.gateTargets[0] !== stage.gateTarget) {
    errors.push(`Task ${task.id} must target gate ${stage.gateTarget} for pipeline stage ${stage.stageId}.`);
  }

  const dependencyStageIds = [];
  for (const dependencyId of task.dependsOn) {
    const dependencyTask = tasksById.get(dependencyId);
    if (!dependencyTask) {
      errors.push(`Task ${task.id} depends on unknown task ${dependencyId}.`);
      continue;
    }

    const dependencyStage = pipelineIndex.stageByTaskType.get(dependencyTask.type);
    if (!dependencyStage) {
      errors.push(`Dependency ${dependencyId} uses unstaged task type ${dependencyTask.type}.`);
      continue;
    }

    dependencyStageIds.push(dependencyStage.stageId);

    if (dependencyStage.index >= stage.index) {
      errors.push(`Task ${task.id} depends on ${dependencyId}, but pipeline order does not allow ${dependencyTask.type} -> ${task.type}.`);
    }
  }

  const requiredStageDependencies = ensureArray(stage.dependsOnStages);
  for (const requiredStageId of requiredStageDependencies) {
    if (!dependencyStageIds.includes(requiredStageId)) {
      errors.push(`Task ${task.id} is missing a dependency from required stage ${requiredStageId}.`);
    }
  }

  if (SUCCESS_STATUSES.has(task.status)) {
    const requiredEvidenceKinds = unique(ensureArray(stage.requiredEvidenceKinds));
    const actualEvidenceKinds = unique(ensureArray(task.evidenceRefs).map((item) => item.kind));

    if (requiredEvidenceKinds.length > 0 && !requiredEvidenceKinds.every((kind) => actualEvidenceKinds.includes(kind))) {
      errors.push(`Task ${task.id} must include evidence kinds [${requiredEvidenceKinds.join(', ')}] before it can remain ${task.status}.`);
    }
  }
};

export const validateTaskEntriesAgainstContracts = async (taskEntries, pipelineId = 'page-delivery', options = {}) => {
  const roleRegistry = await loadRoleRegistry();
  const pipeline = await loadPipelineDefinition(pipelineId);
  const pipelineIndex = buildPipelineIndex(pipeline);
  const tasksById = new Map();
  const errors = [];
  const dependencyEntries = Array.isArray(options.dependencyEntries) ? options.dependencyEntries : [];
  const validationScope = options.validationScope ?? 'full';

  for (const entry of taskEntries) {
    await assertValidBySchema('task', entry.task, `Task ${entry.task.id ?? entry.filePath}`);

    if (tasksById.has(entry.task.id)) {
      errors.push(`Duplicate task id detected: ${entry.task.id}`);
      continue;
    }

    tasksById.set(entry.task.id, entry.task);
  }

  for (const entry of dependencyEntries) {
    if (!entry?.task?.id || tasksById.has(entry.task.id)) continue;
    tasksById.set(entry.task.id, entry.task);
  }

  for (const entry of taskEntries) {
    validateTaskContract(entry.task, tasksById, roleRegistry, pipelineIndex, errors);
  }

  if (validationScope === 'full') {
    const duplicateIds = new Set();
    for (const entry of dependencyEntries) {
      if (!entry?.task?.id) continue;
      if (duplicateIds.has(entry.task.id)) {
        errors.push(`Duplicate task id detected in dependency context: ${entry.task.id}`);
      }
      duplicateIds.add(entry.task.id);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Task contract validation failed for pipeline ${pipelineId}:\n- ${errors.join('\n- ')}`);
  }

  return {
    roleRegistry,
    pipeline,
  };
};

export const assertValidRunState = async (run) => {
  await assertValidBySchema('run', run, `Run ${run.runId}`);
};

export const assertValidEventRecord = async (event) => {
  await assertValidBySchema('event', event, `Event ${event.eventId ?? event.eventName}`);
};

export const assertValidProjectionBundle = async ({ generatedAt, backlog, gates, report, currentArtifacts }) => {
  await assertValidBySchema(
    'report',
    {
      generatedAt,
      backlog: backlog.items,
      gates: gates.items,
      report: {
        runId: report.runId,
        summary: report.summary,
        sections: report.sections,
      },
      currentArtifacts: {
        runId: currentArtifacts.runId,
        runStatus: currentArtifacts.runStatus,
        orchestrationState: currentArtifacts.orchestrationState,
        artifacts: currentArtifacts.artifacts,
        supersededArtifacts: currentArtifacts.supersededArtifacts,
      },
    },
    `Projection bundle for run ${report.runId}`
  );
};
