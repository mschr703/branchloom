export type ChangelogPeriod = 'day' | 'week';
export type ChangelogScope = 'head' | 'saved-worktrees';

export interface ChangelogSource {
  kind: 'project-head' | 'card-worktree';
  cardId?: string;
  cardTitle?: string;
  branch?: string;
}

export interface ChangelogCommit {
  hash: string;
  committedAt: string;
  subject: string;
  sources?: ChangelogSource[];
}

export interface ChangelogIssue { cardId: string | null; cardTitle: string | null; reason: string }

/** A saved local browser result, not proof that a particular commit was served. */
export interface ChangelogQaObservation {
  id: string;
  cardId: string;
  cardTitle: string;
  endedAt: string;
  status: 'passed' | 'failed' | 'error';
  checkoutState: 'clean' | 'dirty' | 'changed' | 'unavailable' | 'not-recorded';
  checkoutHead: string | null;
}

/** Diff comments are activity, never an approval or commit-level review result. */
export interface ChangelogReviewActivity {
  cardId: string;
  cardTitle: string;
  count: number;
  lastAt: string;
}

/** A durable integration receipt; Git presence is checked again for the displayed HEAD. */
export interface ChangelogIntegrationReceipt {
  cardId: string;
  cardTitle: string;
  integratedAt: string;
  integratedHead: string | null;
  targetBranch: string;
  approvalMode: 'manual' | 'automatic' | null;
  headPresence: 'present' | 'missing' | 'unverified';
  review: { reviewedAt: string; matchesSnapshot: boolean } | null;
  test: { scriptName: string; state: string; exitCode: number | null; matchesSnapshot: boolean } | null;
}

export interface ProjectChangelog {
  projectId: string;
  period: ChangelogPeriod;
  since: string;
  until: string;
  checkedAt: string;
  scope: ChangelogScope;
  state: 'ready' | 'no-repository' | 'no-commits';
  head: string | null;
  commits: ChangelogCommit[];
  moreAvailable: boolean;
  issues: ChangelogIssue[];
  checkedWorktrees: number;
  qaObservations: ChangelogQaObservation[];
  qaTotal: number;
  reviewActivity: ChangelogReviewActivity[];
  reviewTotal: number;
  integrationReceipts: ChangelogIntegrationReceipt[];
  integrationTotal: number;
}
