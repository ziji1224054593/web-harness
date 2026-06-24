import type { GateId, GateStatus } from './gate';
import type { RunStatus } from './run';
import type { EvidenceRef, TaskResultStatus, TaskStatus } from './task';

export const ORCHESTRATOR_EVENT_NAMES = [
  'task.created',
  'task.ready',
  'task.started',
  'task.completed',
  'task.blocked',
  'operator.action',
  'gate.updated',
  'report.generated',
] as const;

export type OrchestratorEventName = (typeof ORCHESTRATOR_EVENT_NAMES)[number];

export interface OrchestratorEventBase {
  eventId: string;
  eventName: OrchestratorEventName;
  occurredAt: string;
  runId: string;
}

export interface TaskCreatedEvent extends OrchestratorEventBase {
  eventName: 'task.created';
  taskId: string;
  payload: {
    status: TaskStatus;
    ownerRole: string;
  };
}

export interface TaskReadyEvent extends OrchestratorEventBase {
  eventName: 'task.ready';
  taskId: string;
  payload: {
    status: Extract<TaskStatus, 'ready'>;
  };
}

export interface TaskStartedEvent extends OrchestratorEventBase {
  eventName: 'task.started';
  taskId: string;
  payload: {
    status: Extract<TaskStatus, 'running'>;
  };
}

export interface TaskCompletedEvent extends OrchestratorEventBase {
  eventName: 'task.completed';
  taskId: string;
  payload: {
    status: Extract<TaskResultStatus, 'done' | 'reviewed'>;
    evidence: EvidenceRef[];
  };
}

export interface TaskBlockedEvent extends OrchestratorEventBase {
  eventName: 'task.blocked';
  taskId: string;
  payload: {
    status: Extract<TaskResultStatus, 'blocked' | 'failed'>;
    reason: string;
  };
}

export interface GateUpdatedEvent extends OrchestratorEventBase {
  eventName: 'gate.updated';
  payload: {
    gateId: GateId;
    status: GateStatus;
    evidenceRefs: string[];
  };
}

export interface OperatorActionEvent extends OrchestratorEventBase {
  eventName: 'operator.action';
  payload: {
    action: 'pause' | 'resume' | 'retry' | 'approve' | 'reject' | 'recover';
    operator: string;
    reason: string;
    taskId?: string;
    targetStatus?: string;
  };
}

export interface ReportGeneratedEvent extends OrchestratorEventBase {
  eventName: 'report.generated';
  payload: {
    status: RunStatus;
    summary: string;
  };
}

export type OrchestratorEvent =
  | TaskCreatedEvent
  | TaskReadyEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskBlockedEvent
  | OperatorActionEvent
  | GateUpdatedEvent
  | ReportGeneratedEvent;
