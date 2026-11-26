export type GlobalInboxKind = 'workflow' | 'queue' | 'session' | 'plan' | 'diff' | 'qa' | 'guest';
export type GlobalInboxCategory = 'all' | 'approval' | 'manual' | 'review' | 'paused';

export interface GlobalInboxItem {
  id: string;
  kind: GlobalInboxKind;
  category: Exclude<GlobalInboxCategory, 'all'>;
  projectId: string;
  projectName: string;
  sourceId: string;
  title: string;
  detail: string;
  recordedAt: string;
}

export interface GlobalInboxPage {
  items: GlobalInboxItem[];
  hasMore: boolean;
  limitReached: boolean;
}

export interface GlobalInboxQuery {
  query?: string;
  category?: GlobalInboxCategory;
  offset?: number;
}
