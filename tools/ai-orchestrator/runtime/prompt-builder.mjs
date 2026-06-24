import { readFile } from 'node:fs/promises';

import { resolveRepoPath } from './store.mjs';

const readPromptFile = async (relativePath) => {
  const absolutePath = resolveRepoPath(relativePath);
  return readFile(absolutePath, 'utf8');
};

/**
 * 真实 Agent 执行时，把角色 prompt、任务上下文和输出约束合成一个稳定的执行 prompt。
 */
export const buildTaskExecutionPrompt = async (task, roleConfig, runId) => {
  const rolePrompt = await readPromptFile(roleConfig.prompt);

  return `
你现在通过编排器执行一个任务。必须严格遵循下面的角色约束和任务边界。

## 角色 Prompt
${rolePrompt}

## 当前任务
- Run ID: ${runId}
- Task ID: ${task.id}
- 标题: ${task.title}
- 类型: ${task.type}
- 负责人角色: ${task.ownerRole}
- 优先级: ${task.priority}
- 依赖任务: ${task.dependsOn.join(', ') || '无'}
- 输入路径:
${task.inputs.map((item) => `  - ${item}`).join('\n')}
- 预期输出路径:
${task.outputs.map((item) => `  - ${item}`).join('\n')}
- 验收标准:
${task.acceptance.map((item) => `  - ${item}`).join('\n')}
- 目标 Gate:
${task.gateTargets.map((item) => `  - ${item}`).join('\n')}

## 执行要求
1. 只在当前仓库真实存在的目录和事实源上工作，不要臆造外部结构。
2. 如果任务无法安全完成，返回 blocked 或 failed，并说明原因。
3. 如果你修改了文件，producedOutputs 中只列出实际产出或更新的路径。
4. 输出必须是 JSON，不要加 Markdown 代码块，不要附加解释文字。

## 输出 JSON 结构
{
  "status": "done | blocked | failed | reviewed",
  "summary": "一句话总结结果",
  "producedOutputs": ["path1", "path2"],
  "notes": "补充说明，可为空字符串",
  "evidenceSummary": "给 evidence 使用的简短摘要"
}
`.trim();
};
