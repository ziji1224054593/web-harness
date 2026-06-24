import { readFile } from 'node:fs/promises';

import { assertValidEventRecord } from './contracts.mjs';
import { notifyEvent } from './notifier.mjs';
import { appendTextFile, resolveRepoPath } from './store.mjs';

const nowIso = () => new Date().toISOString();

const safeReadJsonLines = async (relativePath) => {
  try {
    const content = await readFile(resolveRepoPath(relativePath), 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

/**
 * 第三批开始引入 append-only 事件日志，后续换消息队列时也能沿用同一事件形状。
 */
export const appendRunEvent = async (runId, eventName, payload, taskId) => {
  const event = {
    eventId: `${eventName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventName,
    occurredAt: nowIso(),
    runId,
    ...(taskId ? { taskId } : {}),
    payload,
  };

  await assertValidEventRecord(event);
  await appendTextFile(`ai/runtime/events/${runId}.jsonl`, `${JSON.stringify(event)}\n`);
  // 出站播报到 IM 群（best-effort：失败只告警，绝不影响运行态写入）。
  await notifyEvent(event, runId).catch(() => undefined);
  return event;
};

export const readAllRunEvents = async (runId) => safeReadJsonLines(`ai/runtime/events/${runId}.jsonl`);

export const appendOperatorAction = async (runId, action, operator, reason, target = {}) => {
  const record = {
    actionId: `operator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId,
    action,
    operator,
    reason,
    occurredAt: nowIso(),
    ...target,
  };

  await appendTextFile(`ai/runtime/audit/${runId}.jsonl`, `${JSON.stringify(record)}\n`);
  await appendRunEvent(
    runId,
    'operator.action',
    {
      action,
      operator,
      reason,
      ...target,
    },
    target.taskId
  );

  return record;
};

export const readOperatorActions = async (runId, limit = 10) => {
  const records = await safeReadJsonLines(`ai/runtime/audit/${runId}.jsonl`);
  return records.slice(-limit).reverse();
};

export const readRunEvents = async (runId, limit = 20) => {
  const records = await safeReadJsonLines(`ai/runtime/events/${runId}.jsonl`);
  return records.slice(-limit).reverse();
};
