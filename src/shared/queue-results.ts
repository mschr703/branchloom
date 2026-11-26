import type { CardQaPageCheck, CardQaReport, SessionState } from './types';
import type { IntegrationState } from './integration-queue';
import type { IntegrationTestState } from './integration-evidence';

export type QueueResultStatus = 'done' | 'needs-attention' | 'running' | 'skipped' | 'pending';

export interface QueueResultItem {
  cardId: string;
  cardTitle: string;
  workflowId: string;
  workflowName: string;
  activationId: string | null;
  status: QueueResultStatus;
  updatedAt: string;
  lastSession: { id: string; state: SessionState; exitCode: number | null } | null;
  integration: { id: number; state: IntegrationState; sourceHead: string; targetBranch: string;
    integratedHead: string | null; approvalMode: 'manual' | 'automatic' | null } | null;
  test: { id: number; state: IntegrationTestState; scriptName: string; sourceHead: string;
    targetHead: string; endedAt: string | null; queueActivationId: string | null } | null;
  review: { sourceHead: string; targetHead: string; reviewedAt: string; matchesSavedIntegration: boolean } | null;
  qa?: { id: string; status: CardQaReport['status']; endedAt: string; viewportWidth: number;
    viewportHeight: number; pageCheck: CardQaPageCheck } | null;
}

export interface QueueActivationSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endState: 'paused' | 'off' | null;
  endReason: string | null;
  runUntil: string | null;
  continueBlocked: boolean;
  counts: Record<QueueResultStatus, number>;
  total: number;
}

export interface QueueResults {
  projectId: string;
  total: number;
  truncated: boolean;
  counts: Record<QueueResultStatus, number>;
  items: QueueResultItem[];
  latestActivation: QueueActivationSummary | null;
  latestItems: QueueResultItem[];
  latestTruncated: boolean;
}
