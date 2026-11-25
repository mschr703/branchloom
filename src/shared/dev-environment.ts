export interface DevEnvironmentProfile {
  projectId: string;
  executable: string;
  args: string[];
  healthPath: string;
  healthMarker: string;
  updatedAt: string;
  fingerprint: string;
}

export type DevEnvironmentState = 'starting' | 'ready' | 'failed' | 'stopped' | 'interrupted';

export interface CardDevEnvironment {
  id: string;
  projectId: string;
  cardId: string;
  worktreePath: string;
  branch: string;
  port: number;
  pid: number | null;
  url: string;
  state: DevEnvironmentState;
  startedAt: string;
  readyAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  output: string;
  managed: boolean;
}

export interface SaveDevEnvironmentProfile {
  projectId: string;
  executable: string;
  args: string[];
  healthPath: string;
  healthMarker: string;
}

export interface DevEnvironmentCandidate {
  id: string;
  label: string;
  profile: SaveDevEnvironmentProfile;
  evidenceIds: string[];
}

export interface DevEnvironmentInspection {
  projectId: string;
  cardId: string;
  fingerprint: string;
  head: string | null;
  evidence: Array<{ id: string; detail: string }>;
  candidates: DevEnvironmentCandidate[];
  profileMismatch: Array<'executable' | 'arguments' | 'health-path' | 'marker'>;
  failureKind: 'none' | 'missing-dependency' | 'port-in-use' | 'readiness' | 'start-failed';
  warning: string | null;
}

export interface GuidedDevEnvironmentAdvice {
  id: string;
  inspection: DevEnvironmentInspection;
  candidateId: string | null;
  diagnosis: string;
  nextStep: string;
  citedEvidenceIds: string[];
  createdAt: string;
}

export interface DevEnvironmentAuditEvent {
  id: string;
  kind: 'profile' | 'start';
  source: 'manual' | 'guided' | 'card-button';
  at: string;
  outcome: 'saved' | 'requested' | 'started' | 'rejected';
  profileFingerprint: string;
  runId: string | null;
}
