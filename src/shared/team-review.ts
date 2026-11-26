import type { QaGitEvidence } from './qa-git-evidence';

export interface TeamReviewRoom {
  id: string;
  projectId: string;
  cardId: string;
  qaReportId: string;
  scenario: string;
  imageSha256: string;
  imageWidth: number;
  imageHeight: number;
  checkoutObservation: QaGitEvidence | null;
  createdAt: string;
  closedAt: string | null;
}

/** Compares Git checkout observations; it never identifies the files served by a dev server. */
export interface TeamReviewRevision {
  status: 'same-clean-head' | 'different-head' | 'working-tree-dirty' | 'checkout-changed' | 'unavailable';
  currentHead: string | null;
  checkedAt: string;
}

export interface TeamReviewInvite {
  id: string;
  roomId: string;
  displayName: string;
  role: 'reviewer';
  createdAt: string;
  revokedAt: string | null;
}

export interface TeamReviewComment {
  id: string;
  roomId: string;
  cardId: string;
  participantId: string;
  displayName: string;
  body: string;
  x: number;
  y: number;
  imageSha256: string;
  createdAt: string;
}

export interface CreatedTeamReviewRoom {
  room: TeamReviewRoom;
  invite: TeamReviewInvite;
  reviewerSecret: string;
}

export interface CreatedTeamReviewInvite { invite: TeamReviewInvite; reviewerSecret: string }
