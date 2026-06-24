import { EVIDENCE_KIND_BY_TASK_TYPE } from './constants.mjs';

const nowIso = () => new Date().toISOString();

const extractTextBlocks = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextBlocks(item))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }

    if ('content' in value) {
      return extractTextBlocks(value.content);
    }

    if ('result' in value) {
      return extractTextBlocks(value.result);
    }
  }

  return '';
};

const extractJsonText = (rawText) => {
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
};

const normalizeStatus = (task, status) => {
  const allowedStatuses = task.type === 'review' ? new Set(['done', 'blocked', 'failed', 'reviewed']) : new Set(['done', 'blocked', 'failed']);

  if (typeof status === 'string' && allowedStatuses.has(status)) {
    return status;
  }

  return 'blocked';
};

/**
 * 把 SDK 返回的自由文本尽量收敛成编排器统一的 TaskResult 结构。
 */
export const buildTaskResultFromAgent = (task, agentResponse, meta = {}) => {
  const rawText = extractTextBlocks(agentResponse);
  const jsonText = extractJsonText(rawText);

  let parsed = {};
  let parseFailed = false;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = {};
    parseFailed = true;
  }

  const status = normalizeStatus(task, parsed.status);
  const evidenceId = `${task.id}-${Date.now()}`;
  const summary =
    (typeof parsed.summary === 'string' && parsed.summary.trim()) ||
    (rawText.trim() ? rawText.trim().slice(0, 500) : `${task.title} 已由真实 Agent 执行。`);

  const producedOutputs =
    !parseFailed && Array.isArray(parsed.producedOutputs) && parsed.producedOutputs.every((item) => typeof item === 'string')
      ? parsed.producedOutputs
      : [];

  const evidenceSummary = (typeof parsed.evidenceSummary === 'string' && parsed.evidenceSummary.trim()) || summary;

  const notesParts = [];

  if (typeof parsed.notes === 'string' && parsed.notes.trim()) {
    notesParts.push(parsed.notes.trim());
  }

  if (parseFailed) {
    notesParts.push('agent_output_parse_failed=true');
  }

  if (meta.agentRuntime) {
    notesParts.push(`runtime=${meta.agentRuntime}`);
  }

  if (meta.modelId) {
    notesParts.push(`model=${meta.modelId}`);
  }

  return {
    taskId: task.id,
    status,
    summary,
    producedOutputs,
    evidence:
      status === 'blocked' || status === 'failed'
        ? []
        : [
            {
              evidenceId,
              kind: EVIDENCE_KIND_BY_TASK_TYPE[task.type] ?? 'analysis',
              path: `ai/runtime/evidence/${task.id}/${evidenceId}.json`,
              summary: evidenceSummary,
              createdAt: nowIso(),
            },
          ],
    notes: notesParts.join(' | '),
  };
};
