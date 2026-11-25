import type { SessionState } from './types';

export type UsageOrigin = 'direct' | 'workflow' | 'queue' | 'unknown';

/** Small, output-free local record for usage summaries. No provider token data is inferred here. */
export interface UsageSession {
  id: string;
  cardId: string;
  cardTitle: string;
  agentId: string;
  state: SessionState;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  origin: UsageOrigin;
  workflowId: string | null;
  workflowName: string | null;
}

export interface UsageSessionPage { sessions: UsageSession[]; truncated: boolean }
