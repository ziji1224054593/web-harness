import type { GateState } from '../types/gate';
import type { BacklogProjection, GateProjection, ReportProjection } from '../types/report';
import type { RunState } from '../types/run';
import type { TaskResult, TaskSpec } from '../types/task';

export interface Projector {
  projectBacklog(run: RunState, tasks: TaskSpec[]): BacklogProjection;
  projectGates(run: RunState, tasks: TaskSpec[], gates: GateState[]): GateProjection;
  projectReport(run: RunState, tasks: TaskSpec[], results: TaskResult[]): ReportProjection;
}

export const GATE_DESCRIPTIONS: Record<string, string> = {
  G1: 'Requirement refined / 需求已提炼',
  G2: 'Module scanned / 模块已扫描',
  G3: 'Solution aligned / 方案已对齐',
  G4: 'Frontend implemented / 前端已实现',
  G5: 'Validation completed / 校验已完成',
  G6: 'Review completed / 审查已完成',
};
