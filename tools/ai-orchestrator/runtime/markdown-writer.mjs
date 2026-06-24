import { GATE_DESCRIPTIONS } from './constants.mjs';
import { RUN_ARTIFACT_KEYS } from './run-state.mjs';

/**
 * 运行时版本的 markdown writer，供第二批命令层直接使用。
 */
const escapeTableCell = (value) => String(value ?? '').replace(/\|/g, '\\|');

export const renderBacklogMarkdown = (projection) => {
  const lines = [
    '# AI Task Backlog / AI 任务台账',
    '',
    `> Generated at: ${projection.generatedAt}`,
    '',
    '| Task ID / 任务 ID | Feature / 功能 | Owner / 负责人 | Status / 状态 | Inputs / 输入 | Outputs / 输出 | Notes / 备注 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const item of projection.items) {
    lines.push(
      `| ${escapeTableCell(item.taskId)} | ${escapeTableCell(item.feature)} | ${escapeTableCell(item.owner)} | ${escapeTableCell(item.status)} | ${escapeTableCell(item.inputs.join('<br />'))} | ${escapeTableCell(item.outputs.join('<br />'))} | ${escapeTableCell(item.notes ?? '')} |`
    );
  }

  return lines.join('\n');
};

export const renderGateMarkdown = (projection) => {
  const lines = [
    '# Gate Status / 阶段门禁状态',
    '',
    `> Generated at: ${projection.generatedAt}`,
    '',
    '| Gate / 阶段 | Description / 说明 | Status / 状态 | Evidence / 证据 | Notes / 备注 |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const item of projection.items) {
    const description = item.description || GATE_DESCRIPTIONS[item.gateId] || item.gateId;
    lines.push(
      `| ${escapeTableCell(item.gateId)} | ${escapeTableCell(description)} | ${escapeTableCell(item.status)} | ${escapeTableCell(item.evidence.join('<br />'))} | ${escapeTableCell(item.notes ?? '')} |`
    );
  }

  return lines.join('\n');
};

export const renderReportMarkdown = (projection) => {
  const lines = [
    '# AI Change Log / AI 变更记录',
    '',
    `> Generated at: ${projection.generatedAt}`,
    '',
    `## Run ${projection.runId}`,
    '',
    `- ${projection.summary}`,
  ];

  for (const section of projection.sections) {
    lines.push('', `### ${section.title}`, '');

    for (const entry of section.entries) {
      lines.push(`- ${entry}`);
    }
  }

  return lines.join('\n');
};

export const renderCurrentArtifactsMarkdown = (projection) => {
  const lines = [
    `# Current Artifacts — ${projection.runId}`,
    '',
    `> 运行 ID：${projection.runId}`,
    `> 状态：${projection.runStatus}`,
    `> 主编排者：${projection.orchestrationState?.primaryOwner ?? 'system'}`,
    `> 用途：为 QA / Review 阶段提供当前有效文档索引；本文件由 \`ai/runtime/runs/${projection.runId}.json\` 自动投影生成。`,
    '',
    '---',
    '',
    '## 1. 编排治理状态',
    '',
    `- 运行态写策略：\`${projection.orchestrationState?.mode ?? 'single_writer_run'}\``,
    `- 主编排者：\`${projection.orchestrationState?.primaryOwner ?? 'system'}\``,
    `- 主编排角色：\`${projection.orchestrationState?.ownerRole ?? 'lead_orchestrator'}\``,
    `- 协调状态：\`${projection.orchestrationState?.coordinationStatus ?? 'clear'}\``,
    `- 当前阶段：${projection.orchestrationState?.currentStageId ? `\`${projection.orchestrationState.currentStageId}\`` : '—'}`,
    `- 备注：${projection.orchestrationState?.note ?? '—'}`,
    '',
    '---',
    '',
    '## 2. 当前有效文档',
    '',
    '| 字段 | 当前值 | 说明 |',
    '| --- | --- | --- |',
  ];

  for (const key of RUN_ARTIFACT_KEYS) {
    const item = projection.artifacts[key];
    const value = item?.status === 'current' && item.path ? `\`${item.path}\`` : '—';
    const note = item?.note ?? (item?.status === 'current' ? '已登记为当前有效文档。' : '待补齐。');
    lines.push(`| \`${escapeTableCell(key)}\` | ${value} | ${escapeTableCell(note)} |`);
  }

  lines.push('', '---', '', '## 3. Superseded / 忽略范围', '');

  if (projection.supersededArtifacts.length === 0) {
    lines.push('当前无 superseded 文档登记。');
  } else {
    lines.push('| 文件或范围 | 原因 |', '| --- | --- |');
    for (const item of projection.supersededArtifacts) {
      const reason = item.replacedBy ? `${item.note ?? '已被替代。'} -> \`${item.replacedBy}\`` : (item.note ?? '已被替代。');
      lines.push(`| \`${escapeTableCell(item.path)}\` | ${escapeTableCell(reason)} |`);
    }
  }

  lines.push(
    '',
    '---',
    '',
    '## 4. 下游读取规则',
    '',
    '1. QA 阶段优先读取 `current_frontend_handoff`，再读取本轮未关闭缺陷来源。',
    '2. QA 完成后必须维护 `current_review_brief`，供 Review 低 token 启动。',
    '3. Review 阶段优先读取 `current_review_brief`、`current_frontend_handoff` 和当前实现代码。',
    '4. 若缺少必须字段，应更新对应 run state 后重新执行 `ai:sync`，而不是手改本文件。'
  );

  return lines.join('\n');
};
