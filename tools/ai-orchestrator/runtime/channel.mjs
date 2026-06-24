/**
 * 任务对接群投影：把 RUN 的 append-only 事件流渲染成一份人类可读的"群对话" Markdown。
 *
 * - 事实源仍是 `ai/runtime/events/<RUN>.jsonl`；本文件只做只读投影，便于人/Agent 一眼看完整链路。
 * - 与 IM 群（notifier）互补：IM 是实时推送，channel.md 是可回溯的全量时间线。
 */

import { readAllRunEvents } from './events.mjs';
import { formatEventMessage } from './notifier.mjs';
import { writeTextFile } from './store.mjs';

export const channelPathForRun = (runId) => `ai/context/runs/${runId}/channel.md`;

/** 由事件数组渲染群对话 Markdown 文本。 */
export const renderChannelMarkdown = (runId, events = []) => {
  const lines = [
    `# 任务对接群 / Task Channel — ${runId}`,
    '',
    '> 本文件由 RUN 事件流投影生成（只读呈现层）；事实源是 `ai/runtime/events/<RUN>.jsonl`，状态推进仍走 CLI 动词与人工确认门禁。',
    '',
    '| 时间 (UTC) | 消息 |',
    '| ---------- | ---- |',
  ];

  const rows = events
    .map((event) => {
      const text = formatEventMessage(event);
      if (!text) return null;
      const at = (event.occurredAt ?? '').replace('T', ' ').replace(/\..*$/, '');
      return `| ${at} | ${text.replace(/\|/g, '\\|')} |`;
    })
    .filter(Boolean);

  if (rows.length === 0) {
    lines.push('| — | 群内暂无消息。产品派发任务后，各角色的领取/完成/打回/通过将在此显示。 |');
  } else {
    lines.push(...rows);
  }
  lines.push('');
  return lines.join('\n');
};

/** 读取事件并把群对话写到 ai/context/runs/<RUN>/channel.md。 */
export const projectChannel = async (runId) => {
  const events = await readAllRunEvents(runId);
  const markdown = renderChannelMarkdown(runId, events);
  await writeTextFile(channelPathForRun(runId), markdown);
  return { path: channelPathForRun(runId), messageCount: events.filter((e) => formatEventMessage(e)).length };
};
