/**
 * 这一层只负责和 Cursor SDK 打交道，避免把 SDK 细节扩散到调度器。
 */

import { REPO_ROOT } from './store.mjs';

const DEFAULT_MODEL_ID = process.env.CURSOR_AGENT_MODEL || 'composer-2';

export const loadCursorSdk = async () => {
  try {
    return await import('@cursor/sdk');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`未能加载 @cursor/sdk，请先安装依赖后再执行真实 Agent 调用。底层错误: ${message}`);
  }
};

export const resolveCursorAgentOptions = () => {
  const apiKey = process.env.CURSOR_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('缺少 CURSOR_API_KEY，无法执行真实 Agent 调用。');
  }

  return {
    apiKey,
    model: {
      id: DEFAULT_MODEL_ID,
    },
    local: {
      // 中文注释：真实 Agent 应始终针对业务仓根目录运行，而不是子包目录。
      cwd: REPO_ROOT,
      settingSources: [],
    },
  };
};

/**
 * 第二批先用 one-shot 调用方式，后续如果需要多轮上下文再切到 Agent.create/resume。
 */
export const runCursorAgentPrompt = async (prompt) => {
  const { Agent, CursorAgentError } = await loadCursorSdk();

  try {
    const result = await Agent.prompt(prompt, resolveCursorAgentOptions());
    return {
      kind: 'result',
      payload: result,
    };
  } catch (error) {
    if (error instanceof CursorAgentError) {
      return {
        kind: 'startup_error',
        payload: {
          message: error.message,
          retryable: error.isRetryable,
        },
      };
    }

    throw error;
  }
};
