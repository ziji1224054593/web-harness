import { createHash } from 'node:crypto';

import { validateTaskEntriesAgainstContracts } from './contracts.mjs';
import { listRelativeFiles, pathExists, readJsonFile, readYamlFile, statRelativePath, writeJsonFile } from './store.mjs';

const TASK_INDEX_PATH = 'ai/runtime/indexes/tasks.json';

const buildHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const buildIndexPayload = (taskEntries, pipelineId) => {
  const generatedAt = new Date().toISOString();
  const files = taskEntries.map(({ filePath, task, stats }) => ({
    filePath,
    taskId: task.id,
    pipelineId,
    dependsOn: task.dependsOn,
    ownerRole: task.ownerRole,
    status: task.status,
    mtimeMs: stats?.mtimeMs ?? 0,
  }));
  const tasks = Object.fromEntries(
    files.map((item) => [
      item.taskId,
      {
        filePath: item.filePath,
        pipelineId: item.pipelineId,
        dependsOn: item.dependsOn,
        ownerRole: item.ownerRole,
        status: item.status,
        mtimeMs: item.mtimeMs,
      },
    ])
  );

  return {
    generatedAt,
    pipelineId,
    files,
    tasks,
    indexHash: buildHash(files),
  };
};

export const buildTaskIndex = async (pipelineId = 'page-delivery') => {
  const taskFiles = await listRelativeFiles('ai/runtime/tasks', '.yaml');
  const tasks = await Promise.all(taskFiles.map((filePath) => readYamlFile(filePath)));
  const stats = await Promise.all(taskFiles.map((filePath) => statRelativePath(filePath)));
  const taskEntries = taskFiles
    .map((filePath, index) => ({
      filePath,
      task: tasks[index],
      stats: stats[index],
    }))
    .sort((left, right) => left.task.id.localeCompare(right.task.id));

  await validateTaskEntriesAgainstContracts(
    taskEntries.map(({ filePath, task }) => ({
      filePath,
      task,
    })),
    pipelineId
  );

  const indexPayload = buildIndexPayload(taskEntries, pipelineId);
  await writeJsonFile(TASK_INDEX_PATH, indexPayload);
  return indexPayload;
};

export const readTaskIndex = async () => readJsonFile(TASK_INDEX_PATH);

export const ensureTaskIndex = async (pipelineId = 'page-delivery') => {
  const exists = await pathExists(TASK_INDEX_PATH);
  if (!exists) {
    return buildTaskIndex(pipelineId);
  }

  const currentIndex = await readTaskIndex();
  const taskFiles = await listRelativeFiles('ai/runtime/tasks', '.yaml');

  if (!Array.isArray(currentIndex?.files) || currentIndex.files.length !== taskFiles.length) {
    return buildTaskIndex(pipelineId);
  }

  const stats = await Promise.all(taskFiles.map((filePath) => statRelativePath(filePath)));
  const nextFingerprint = buildHash(
    taskFiles.map((filePath, index) => ({
      filePath,
      mtimeMs: stats[index]?.mtimeMs ?? 0,
    }))
  );
  const storedFingerprint = buildHash(
    currentIndex.files.map((file) => ({
      filePath: file.filePath,
      mtimeMs: file.mtimeMs ?? 0,
    }))
  );

  if (nextFingerprint !== storedFingerprint || currentIndex.pipelineId !== pipelineId) {
    return buildTaskIndex(pipelineId);
  }

  return currentIndex;
};

export const resolveRunTaskIds = (run, taskIndex) => {
  const requestedTaskIds = Array.isArray(run.taskIds) ? [...run.taskIds] : [];
  const resolvedTaskIds = new Set();
  const visit = (taskId) => {
    if (!taskId || resolvedTaskIds.has(taskId)) return;
    resolvedTaskIds.add(taskId);
    const taskEntry = taskIndex.tasks?.[taskId];
    for (const dependencyId of taskEntry?.dependsOn ?? []) {
      visit(dependencyId);
    }
  };

  for (const taskId of requestedTaskIds) {
    visit(taskId);
  }

  return [...resolvedTaskIds];
};

export const loadIndexedTaskEntriesForRun = async (run) => {
  const taskIndex = await ensureTaskIndex(run.pipelineId);
  const taskIds = resolveRunTaskIds(run, taskIndex);
  const taskFiles = taskIds
    .map((taskId) => taskIndex.tasks?.[taskId]?.filePath)
    .filter(Boolean)
    .sort();
  const tasks = await Promise.all(taskFiles.map((filePath) => readYamlFile(filePath)));

  return taskFiles
    .map((filePath, index) => ({
      filePath,
      task: tasks[index],
    }))
    .sort((left, right) => left.task.id.localeCompare(right.task.id));
};

export const loadIndexedTaskEntries = async (pipelineId = 'page-delivery') => {
  const taskIndex = await ensureTaskIndex(pipelineId);
  const taskFiles = taskIndex.files.map((file) => file.filePath).sort();
  const tasks = await Promise.all(taskFiles.map((filePath) => readYamlFile(filePath)));

  return taskFiles
    .map((filePath, index) => ({
      filePath,
      task: tasks[index],
    }))
    .sort((left, right) => left.task.id.localeCompare(right.task.id));
};

export { TASK_INDEX_PATH };
