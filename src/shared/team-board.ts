import type { CardPriority } from './types';

export interface TeamBoardInvite {
  id: string;
  projectId: string;
  displayName: string;
  role: 'viewer';
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface TeamBoardSnapshot {
  projectName: string;
  observedAt: string;
  columns: Array<{ id: string; name: string }>;
  cards: Array<{ id: string; columnId: string; title: string; priority: CardPriority; runningSince: string | null }>;
  queueState: 'off' | 'running' | 'paused';
  truncated: boolean;
}

export interface CreatedTeamBoardInvite {
  invite: TeamBoardInvite;
  secret: string;
}
