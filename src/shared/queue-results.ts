import type { SessionState } from './types';

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
