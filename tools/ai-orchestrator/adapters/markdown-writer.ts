import { GATE_DESCRIPTIONS } from '../core/projector';
import type { BacklogProjection, GateProjection, ReportProjection } from '../types/report';

export const renderBacklogMarkdown = (projection: BacklogProjection): string => {
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
      `| ${item.taskId} | ${item.feature} | ${item.owner} | ${item.status} | ${item.inputs.join('<br />')} | ${item.outputs.join('<br />')} | ${item.notes ?? ''} |`
    );
  }

  return lines.join('\n');
};

export const renderGateMarkdown = (projection: GateProjection): string => {
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
    lines.push(`| ${item.gateId} | ${description} | ${item.status} | ${item.evidence.join('<br />')} | ${item.notes ?? ''} |`);
  }

  return lines.join('\n');
};

export const renderReportMarkdown = (projection: ReportProjection): string => {
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
