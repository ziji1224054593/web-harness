export const TASK_STATUSES = ['todo', 'ready', 'running', 'blocked', 'done', 'failed', 'reviewed'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPES = ['requirement', 'scan', 'solution', 'implementation', 'validation', 'review', 'report'] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const EVIDENCE_KINDS = ['analysis', 'decision', 'implementation', 'validation', 'review', 'manual_override', 'report_entry'] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface EvidenceRef {
  evidenceId: string;
  kind: EvidenceKind;
  path: string;
  summary: string;
  createdAt: string;
}

export interface ValidationCheckResult {
  checkId: string;
  command: string;
  description: string;
  status: 'passed' | 'failed' | 'blocked';
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdoutSnippet: string;
  stderrSnippet: string;
}

export interface TaskExecutionState {
  leaseId: string;
  claimedBy: string;
  claimedAt: string;
  leaseUntil: string;
  attempt: number;
}

export interface TaskSpec {
  id: string;
  title: string;
  type: TaskType;
  ownerRole: string;
  priority: TaskPriority;
  dependsOn: string[];
  inputs: string[];
  outputs: string[];
  acceptance: string[];
  gateTargets: string[];
  status: TaskStatus;
  evidenceRefs: EvidenceRef[];
  metadata?: Record<string, string>;
  executionState?: TaskExecutionState;
}

export const TASK_RESULT_STATUSES = ['done', 'blocked', 'failed', 'reviewed'] as const;

export type TaskResultStatus = (typeof TASK_RESULT_STATUSES)[number];

export interface TaskResult {
  taskId: string;
  status: TaskResultStatus;
  summary: string;
  producedOutputs: string[];
  evidence: EvidenceRef[];
  notes?: string;
  validationResults?: ValidationCheckResult[];
}
