export type ReviewInboxSource = 'plan' | 'diff' | 'qa' | 'guest';

export interface ReviewInboxItem {
  id: string;
  kind: ReviewInboxSource;
  projectId: string;
  sourceId: string;
  sourceTitle: string;
  location: string;
  body: string;
  createdAt: string;
  qaStatus?: 'failed' | 'error';
}

export interface ReviewInboxPage {
  items: ReviewInboxItem[];
  hasMore: boolean;
}

export interface ReviewInboxQuery {
  projectId: string;
  query?: string;
  offset?: number;
}

export interface AcknowledgeReviewInboxComment {
  projectId: string;
  kind: 'plan' | 'diff';
  commentId: string;
}

export interface AcknowledgeQaInboxReport { projectId: string; reportId: string }
export interface AcknowledgeGuestInboxComment { projectId: string; commentId: string }
