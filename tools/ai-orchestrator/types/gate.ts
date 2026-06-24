export const GATE_IDS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'] as const;

export type GateId = (typeof GATE_IDS)[number];

export const GATE_STATUSES = ['todo', 'in_progress', 'passed', 'blocked'] as const;

export type GateStatus = (typeof GATE_STATUSES)[number];

export interface GateState {
  gateId: GateId;
  status: GateStatus;
  evidenceRefs: string[];
  note?: string;
}
