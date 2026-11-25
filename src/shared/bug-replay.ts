import type { QaGitEvidence } from './qa-git-evidence';

export type BugReplayTarget = { kind: 'test-id' | 'id'; value: string };
export type BugReplayAction = { kind: 'click'; target: BugReplayTarget } | { kind: 'resize'; width: number; height: number };
export type BugDiagnosticReference = { kind: 'console' | 'load'; category: 'TypeError' | 'ReferenceError' | 'SyntaxError' | 'RangeError' | 'NetworkError' | 'ConsoleError' | 'LoadError'; line: number | null; capturedAt: string };

/** A capture stays in memory until the user explicitly saves it on a card. */
export interface BugCaptureDraft {
  token: string;
  projectId: string;
  url: string;
  width: number;
  height: number;
  actions: BugReplayAction[];
  diagnostics: BugDiagnosticReference[];
  ignoredClicks: number;
  startedAt: string;
}

export interface BugScenario {
  id: string;
  projectId: string;
  cardId: string;
  url: string;
  width: number;
  height: number;
  actions: BugReplayAction[];
  diagnostics: BugDiagnosticReference[];
  expectation: { target: BugReplayTarget; state: 'visible' | 'hidden' };
  cardRevision: number;
  environmentProfile: string;
  createdAt: string;
}

export interface BugReplayResult {
  id: string;
  scenarioId: string;
  cardId: string;
  projectId: string;
  status: 'passed' | 'failed' | 'error';
  observed: string;
  requestedUrl: string;
  environmentRunId: string;
  checkedAt: string;
  viewportWidth: number;
  viewportHeight: number;
  gitEvidence: QaGitEvidence;
}
