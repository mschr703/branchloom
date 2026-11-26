import type { SessionState } from './types';

export type QueueResultStatus = 'done' | 'needs-attention' | 'running' | 'skipped' | 'pending';

export interface QueueResultItem {
  cardId: string;
  cardTitle: string;
  workflowId: string;
  workflowName: string;
  status: QueueResultStatus;
  updatedAt: string;
  lastSession: { id: string; state: SessionState; exitCode: number | null } | null;
}

export interface QueueResults {
  projectId: string;
  total: number;
  truncated: boolean;
  counts: Record<QueueResultStatus, number>;
  items: QueueResultItem[];
}
