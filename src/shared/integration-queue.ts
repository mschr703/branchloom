export type IntegrationState = 'queued' | 'ready' | 'blocked' | 'integrating' | 'integrated';

export interface IntegrationItem {
  id: number;
  projectId: string;
  cardId: string;
  targetBranch: string;
  sourceHead: string;
  targetHead: string;
  cardFingerprint: string;
  state: IntegrationState;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  integratedHead: string | null;
}
