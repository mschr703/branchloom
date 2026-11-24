import type { CardPriority } from './types';

export interface AgentCardMetadataAudit {
  id: string;
  projectId: string;
  cardId: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  beforePriority: CardPriority;
  afterPriority: CardPriority;
  beforeLabels: string[];
  afterLabels: string[];
  reason: string;
  changedAt: string;
}
