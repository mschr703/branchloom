import type { AgentPreset, ColumnEffort } from './types';

export type RunSource = 'card-text' | 'manual-prompt' | 'approved-wireframe' | 'api-contract' | 'component-reference' | 'codex-resume-id' | 'codex-resume-picker';
export type PromptDelivery = 'argv' | 'pty-delayed' | 'pty-written' | 'resume' | 'none' | 'unknown';
export type VersionCheck = 'unchecked' | 'ready' | 'timeout' | 'error';

export interface RunGitPoint {
  scope: 'project' | 'card-worktree';
  head: string | null;
  dirty: boolean | null;
  checkedAt: string;
}

/** A snapshot of locally observed launch facts, not a claim about model execution. */
export interface RunLaunchEvidence {
  sessionId: string;
  agentName: string;
  agentKind: AgentPreset['kind'];
  mode: 'interactive' | 'one-shot' | 'resume';
  configuredModel: string | null;
  configuredEffort: ColumnEffort | null;
  profileArgumentCount: number;
  sources: RunSource[];
  promptDelivery: PromptDelivery;
  git: RunGitPoint;
  version: string | null;
  versionCheck: VersionCheck;
  versionCheckedAt: string | null;
  recordedAt: string;
}

export interface RunLinkedQa {
  reportId: string;
  linkedAt: string;
  status: 'passed' | 'failed' | 'error';
  startedAt: string;
  endedAt: string;
  requestedUrl: string;
  viewportWidth: number;
  viewportHeight: number;
}

export interface SessionRunEvidence {
  sessionId: string;
  projectId: string;
  cardId: string;
  launch: RunLaunchEvidence | null;
  linkedQa: RunLinkedQa[];
}
