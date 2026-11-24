import type { SessionState } from './types';

/** Small, output-free local record for usage summaries. No provider token data is inferred here. */
export interface UsageSession {
  id: string;
  agentId: string;
  state: SessionState;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
}

export interface UsageSessionPage { sessions: UsageSession[]; truncated: boolean }
