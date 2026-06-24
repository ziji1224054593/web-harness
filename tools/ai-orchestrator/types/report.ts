import type { GateId, GateStatus } from './gate';
import type { RunArtifactEntry, RunArtifactKey, SupersededArtifactEntry } from './run';
import type { TaskStatus } from './task';

export interface BacklogProjectionItem {
  taskId: string;
  feature: string;
  owner: string;
  status: TaskStatus;
  inputs: string[];
  outputs: string[];
  notes?: string;
}

export interface BacklogProjection {
  generatedAt: string;
  items: BacklogProjectionItem[];
}

export interface GateProjectionItem {
  gateId: GateId;
  description: string;
  status: GateStatus;
  evidence: string[];
  notes?: string;
}

export interface GateProjection {
  generatedAt: string;
  items: GateProjectionItem[];
}

export interface ReportSection {
  title: string;
  entries: string[];
}

export interface ReportProjection {
  generatedAt: string;
  runId: string;
  summary: string;
  sections: ReportSection[];
}

export interface CurrentArtifactsProjection {
  generatedAt: string;
  runId: string;
  runStatus: string;
  artifacts: Record<RunArtifactKey, RunArtifactEntry>;
  supersededArtifacts: SupersededArtifactEntry[];
}
