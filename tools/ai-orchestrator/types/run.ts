import type { GateState } from './gate';

export const RUN_STATUSES = ['planning', 'running', 'paused', 'blocked', 'completed', 'failed'] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_ARTIFACT_KEYS = [
  'current_ux_interaction',
  'current_frontend_handoff',
  'current_review_brief',
  'current_qa_report',
  'current_regression_report',
  'current_review_report',
  'current_delivery_report',
] as const;

export type RunArtifactKey = (typeof RUN_ARTIFACT_KEYS)[number];

export interface RunArtifactEntry {
  status: 'missing' | 'current';
  path?: string;
  note?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SupersededArtifactEntry {
  path: string;
  note?: string;
  replacedBy?: string;
  updatedAt: string;
  updatedBy: string;
}

export const RUN_TIERS = ['light', 'standard', 'full'] as const;

export type RunTier = (typeof RUN_TIERS)[number];

export interface RunReworkState {
  rounds: number;
  maxRounds: number;
  lastReason?: string;
  tripped: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface RunControlState {
  paused: boolean;
  reason?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RunOrchestrationState {
  mode: 'single_writer_run';
  primaryOwner: string;
  ownerRole: string;
  currentStageId?: string;
  coordinationStatus: 'clear' | 'watch' | 'conflict';
  note?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RunLockState {
  strategy: 'lock_file_cas';
  lockPath: string;
  lastHeldBy: string;
  lastAcquiredAt: string;
  lastReleasedAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RunProjectionState {
  projectionMode: 'shared_and_per_run';
  inputHash: string;
  backlogHash: string;
  gatesHash: string;
  reportHash: string;
  currentArtifactsHash: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RunTaskIndexState {
  indexPath: string;
  indexHash: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RunExecutionClaim {
  taskId: string;
  leaseId: string;
  claimedBy: string;
  claimedAt: string;
  leaseUntil: string;
}

export interface RunExecutionState {
  coordinationMode: 'multiprocess_leased';
  workerLeaseMs: number;
  activeClaims: RunExecutionClaim[];
  updatedAt: string;
  updatedBy: string;
}

export interface RunState {
  runId: string;
  pipelineId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  status: RunStatus;
  tier?: RunTier;
  reworkState?: RunReworkState;
  taskIds: string[];
  readyQueue: string[];
  blockedTasks: string[];
  completedTasks: string[];
  failedTasks: string[];
  gateStateIds: string[];
  gateStates: GateState[];
  controlState: RunControlState;
  orchestrationState: RunOrchestrationState;
  lockState: RunLockState;
  projectionState: RunProjectionState;
  taskIndexState: RunTaskIndexState;
  executionState: RunExecutionState;
  artifacts: Record<RunArtifactKey, RunArtifactEntry>;
  supersededArtifacts: SupersededArtifactEntry[];
}
