import { writeJsonFile } from './store.mjs';

/**
 * 每个任务完成后都落一份结构化证据，后续 Gate/Report 只依赖这些证据推进。
 */
export const persistTaskEvidence = async (runId, task, result) => {
  const persistedPaths = [];
  const validationResults = Array.isArray(result.validationResults) ? result.validationResults : [];

  for (const evidence of result.evidence) {
    const relativePath = `ai/runtime/evidence/${runId}/${evidence.evidenceId}.json`;
    const evidenceIndex = persistedPaths.length;
    persistedPaths.push(relativePath);

    await writeJsonFile(relativePath, {
      runId,
      taskId: task.id,
      taskType: task.type,
      ownerRole: task.ownerRole,
      resultStatus: result.status,
      summary: result.summary,
      notes: result.notes ?? '',
      evidence,
      validationResult: validationResults[evidenceIndex] ?? null,
      producedOutputs: result.producedOutputs,
    });
  }

  return persistedPaths;
};
