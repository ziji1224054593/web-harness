/**
 * 这些常量和第一批的类型文件保持一致，用于第二批命令层的运行时判断。
 */

export const GATE_DESCRIPTIONS = {
  G1: 'Requirement refined / 需求已提炼',
  G2: 'Module scanned / 模块已扫描',
  G3: 'Solution aligned / 方案已对齐',
  G4: 'Frontend implemented / 前端已实现',
  G5: 'Validation completed / 校验已完成',
  G6: 'Review completed / 审查已完成',
};

export const TASK_SUCCESS_STATUSES = new Set(['done', 'reviewed']);
export const TASK_BLOCKED_STATUSES = new Set(['blocked', 'failed']);

export const EVIDENCE_KIND_BY_TASK_TYPE = {
  requirement: 'analysis',
  scan: 'analysis',
  solution: 'decision',
  implementation: 'implementation',
  validation: 'validation',
  review: 'review',
  report: 'report_entry',
};
