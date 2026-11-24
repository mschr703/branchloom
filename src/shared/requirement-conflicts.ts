export type RequirementStance = 'required' | 'forbidden';
export interface RequirementClaim {
  id: string;
  projectId: string;
  cardId: string;
  cardTitle: string;
  criterionId: string;
  statement: string;
  cardRevision: number;
  component: string;
  scope: string;
  property: string;
  stance: RequirementStance;
  current: boolean;
  createdAt: string;
}
export interface RequirementDecision {
  id: string;
  pairKey: string;
  fingerprint: string;
  status: 'chosen' | 'dismissed';
  winnerClaimId: string | null;
  winnerCardId: string | null;
  winnerStatement: string | null;
  reason: string;
  leftCardId: string;
  rightCardId: string;
  leftStatement: string;
  rightStatement: string;
  leftCardRevision: number;
  rightCardRevision: number;
  decidedAt: string;
  current: boolean;
}
export interface RequirementConflict {
  pairKey: string;
  fingerprint: string;
  component: string;
  scope: string;
  property: string;
  left: RequirementClaim;
  right: RequirementClaim;
  current: boolean;
  decision: RequirementDecision | null;
}
export interface RequirementConflictBoard {
  claims: RequirementClaim[];
  conflicts: RequirementConflict[];
  decisionHistory: RequirementDecision[];
  cardRevisions: Record<string, number>;
  limited: boolean;
}

export function cardRequirementView(board: RequirementConflictBoard, cardId: string): { open: RequirementConflict[]; history: RequirementDecision[] } {
  return {
    open: board.conflicts.filter((item) => (item.left.cardId === cardId || item.right.cardId === cardId) && !item.decision),
    history: board.decisionHistory.filter((item) => item.leftCardId === cardId || item.rightCardId === cardId),
  };
}
