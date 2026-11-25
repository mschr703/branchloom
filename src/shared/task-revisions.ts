export type TaskRevisionDelivery = 'prepared' | 'submitting' | 'submitted' | 'included' | 'uncertain';

export interface TaskRevision {
  id: string;
  projectId: string;
  cardId: string;
  number: number;
  baseContentRevision: number;
  committedContentRevision: number;
  fromTitle: string;
  fromDescription: string;
  toTitle: string;
  toDescription: string;
  reason: string;
  createdAt: string;
  sourceSessionId: string | null;
  delivery: TaskRevisionDelivery;
  targetSessionId: string | null;
  deliveredAt: string | null;
}

export interface TaskRevisionHistory {
  contentRevision: number;
  total: number;
  revisions: TaskRevision[];
}

export interface ConfirmTaskRevisionInput {
  projectId: string;
  cardId: string;
  expectedContentRevision: number;
  title: string;
  description: string;
  reason: string;
}
