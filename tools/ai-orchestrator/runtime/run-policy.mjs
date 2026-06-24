/**
 * RUN 分档（tier）、阶段门禁与返工熔断的纯策略函数。
 *
 * 设计原则：本模块只做**判定**，不做持久化。判定结果由 commands 层落到 run state，
 * 因此这里的函数全部可在不触碰文件系统的前提下单测。
 *
 * - 分档（tier）：light / standard / full，决定哪些 Gate 是"交付必经"。
 * - 阶段门禁：进入 Frontend / QA 前必须满足的 artifact 前置条件（工具级强制，替代 prompt 口头约定）。
 * - 返工熔断：多轮"修改→QA→回归"受 maxRounds 上限约束，触顶升级人工裁决。
 */

import { GATE_DESCRIPTIONS } from './constants.mjs';

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// 分档（tier）
// ---------------------------------------------------------------------------

export const RUN_TIERS = ['light', 'standard', 'full'];
export const DEFAULT_RUN_TIER = 'standard';

/**
 * 各档可跳过的 Gate（其余 GATE_DESCRIPTIONS 中的 Gate 均为交付必经）。
 * - light：纯文案 / 小修 / 纯脚本 / 无前台交互变化——跳过 G3(方案与交互对齐) 与 G6(交付前审查)。
 * - standard / full：完整门禁链，不跳过任何 Gate（二者差异在流程严谨度，由 prompt 承载，不改变门禁拓扑）。
 */
const SKIPPABLE_GATES_BY_TIER = {
  light: new Set(['G3', 'G6']),
  standard: new Set(),
  full: new Set(),
};

export const normalizeRunTier = (tier) => (RUN_TIERS.includes(tier) ? tier : DEFAULT_RUN_TIER);

export const requiredGatesForTier = (tier) => {
  const skippable = SKIPPABLE_GATES_BY_TIER[normalizeRunTier(tier)] ?? new Set();
  return Object.keys(GATE_DESCRIPTIONS).filter((gateId) => !skippable.has(gateId));
};

export const isGateRequiredForTier = (gateId, tier) => requiredGatesForTier(tier).includes(gateId);

/**
 * 交付就绪判定：当前 tier 要求的每个 Gate 都必须为 passed。
 * 跳过的 Gate 不参与判定（例如 light 档不要求 G3/G6）。
 */
export const isRunDeliverable = (run, tier = run?.tier) => {
  const required = new Set(requiredGatesForTier(tier));
  const gateStatusById = new Map((run?.gateStates ?? []).map((gate) => [gate.gateId, gate.status]));
  const blocking = [...required].filter((gateId) => gateStatusById.get(gateId) !== 'passed');

  if (blocking.length > 0) {
    return {
      deliverable: false,
      tier: normalizeRunTier(tier),
      blockingGates: blocking,
      reason: `Run is not deliverable for tier ${normalizeRunTier(tier)}: gates not passed -> ${blocking.join(', ')}.`,
    };
  }

  return { deliverable: true, tier: normalizeRunTier(tier), blockingGates: [] };
};

// ---------------------------------------------------------------------------
// 阶段门禁（工具级强制）
// ---------------------------------------------------------------------------

const isArtifactCurrent = (run, key) => run?.artifacts?.[key]?.status === 'current';

/**
 * 进入 Frontend 实现阶段的前置条件。
 * standard / full 档（即需要 G3 的档）必须先有人工确认的 current_ux_interaction artifact；
 * light 档跳过 UX，不强制该 artifact。
 */
export const canEnterFrontendPhase = (run, tier = run?.tier) => {
  if (!isGateRequiredForTier('G3', tier)) {
    return { allowed: true };
  }
  if (!isArtifactCurrent(run, 'current_ux_interaction')) {
    return {
      allowed: false,
      reason:
        'Frontend phase requires a confirmed current_ux_interaction artifact (standard/full tier). Register it via ai:artifact before advancing.',
    };
  }
  return { allowed: true };
};

/**
 * 进入 QA 正式验证阶段的前置条件：必须先有人工确认的 current_frontend_handoff artifact。
 */
export const canEnterQaPhase = (run) => {
  if (!isArtifactCurrent(run, 'current_frontend_handoff')) {
    return {
      allowed: false,
      reason: 'QA phase requires a confirmed current_frontend_handoff artifact. Register it via ai:artifact before advancing.',
    };
  }
  return { allowed: true };
};

// ---------------------------------------------------------------------------
// 返工熔断（rework circuit breaker）
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_REWORK_ROUNDS = 3;

export const createDefaultReworkState = (maxRounds = DEFAULT_MAX_REWORK_ROUNDS, updatedAt = nowIso(), updatedBy = 'system') => ({
  rounds: 0,
  maxRounds,
  lastReason: '',
  tripped: false,
  updatedAt,
  updatedBy,
});

export const normalizeReworkState = (state = {}, updatedAt = nowIso(), updatedBy = 'system') => {
  const maxRounds = typeof state?.maxRounds === 'number' && state.maxRounds > 0 ? state.maxRounds : DEFAULT_MAX_REWORK_ROUNDS;
  const rounds = typeof state?.rounds === 'number' && state.rounds >= 0 ? state.rounds : 0;
  return {
    rounds,
    maxRounds,
    lastReason: typeof state?.lastReason === 'string' ? state.lastReason : '',
    tripped: Boolean(state?.tripped) || rounds >= maxRounds,
    updatedAt: state?.updatedAt ?? updatedAt,
    updatedBy: state?.updatedBy ?? updatedBy,
  };
};

export const canReworkAgain = (state = {}) => {
  const normalized = normalizeReworkState(state);
  if (normalized.tripped || normalized.rounds >= normalized.maxRounds) {
    return {
      allowed: false,
      reason: `Rework circuit breaker tripped: ${normalized.rounds}/${normalized.maxRounds} rounds used. Escalate to human adjudication instead of looping rework again.`,
    };
  }
  return { allowed: true };
};

/**
 * 登记一轮返工。触顶则抛错（调用方应捕获并升级人工裁决），否则返回 rounds+1 的新状态。
 */
export const registerReworkRound = (state = {}, reason = '', updatedBy = 'system', updatedAt = nowIso()) => {
  const normalized = normalizeReworkState(state, updatedAt, updatedBy);
  const decision = canReworkAgain(normalized);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  const rounds = normalized.rounds + 1;
  return {
    rounds,
    maxRounds: normalized.maxRounds,
    lastReason: reason || normalized.lastReason,
    tripped: rounds >= normalized.maxRounds,
    updatedAt,
    updatedBy,
  };
};
