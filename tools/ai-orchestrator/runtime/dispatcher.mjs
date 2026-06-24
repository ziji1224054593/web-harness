import { runCursorAgentPrompt } from './cursor-agent.mjs';
import { buildTaskExecutionPrompt } from './prompt-builder.mjs';
import { buildTaskResultFromAgent } from './result-parser.mjs';
import { runValidationTask } from './validation-adapter.mjs';

/**
 * dispatcher 负责把调度器抽象任务转换成一次真实的 Agent 调用。
 * 如果 SDK、鉴权或角色配置不满足要求，会返回结构化阻断结果。
 */
export const dispatchTask = async (task, roleRegistry, run, projectContract) => {
  const roleConfig = roleRegistry.roles?.[task.ownerRole];

  if (!roleConfig) {
    return {
      taskId: task.id,
      status: 'blocked',
      summary: `Role ${task.ownerRole} is not registered.`,
      producedOutputs: [],
      evidence: [],
      notes: '未找到角色注册信息，任务被阻断。',
    };
  }

  if (!Array.isArray(roleConfig.allowedTaskTypes) || !roleConfig.allowedTaskTypes.includes(task.type)) {
    return {
      taskId: task.id,
      status: 'blocked',
      summary: `Role ${task.ownerRole} cannot execute task type ${task.type}.`,
      producedOutputs: [],
      evidence: [],
      notes: '任务类型与角色约束不匹配，任务被阻断。',
    };
  }

  if (task.type === 'validation') {
    return runValidationTask(task, projectContract);
  }

  try {
    const prompt = await buildTaskExecutionPrompt(task, roleConfig, run.runId);
    const sdkResponse = await runCursorAgentPrompt(prompt);

    if (sdkResponse.kind === 'startup_error') {
      return {
        taskId: task.id,
        status: 'blocked',
        summary: `Agent 启动失败：${sdkResponse.payload.message}`,
        producedOutputs: [],
        evidence: [],
        notes: `retryable=${sdkResponse.payload.retryable}`,
      };
    }

    const payload = sdkResponse.payload;
    if (payload?.status === 'error') {
      return {
        taskId: task.id,
        status: 'failed',
        summary: `Agent 运行失败：${task.title}`,
        producedOutputs: [],
        evidence: [],
        notes: `真实 Agent 已启动但运行报错，请检查 transcript。Prompt: ${roleConfig.prompt}`,
      };
    }

    return buildTaskResultFromAgent(task, payload, {
      agentRuntime: 'cursor-local',
      modelId: process.env.CURSOR_AGENT_MODEL || 'composer-2',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      taskId: task.id,
      status: 'blocked',
      summary: `Agent adapter 执行失败：${task.title}`,
      producedOutputs: [],
      evidence: [],
      notes: message,
    };
  }
};
