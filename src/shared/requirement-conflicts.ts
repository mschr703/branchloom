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
export interface RequirementConflictSuggestion {
  criterionId: string;
  cardId: string;
  cardTitle: string;
  statement: string;
  cardRevision: number;
  proposedStance: RequirementStance;
  source: RequirementClaim;
}
export interface RequirementSuggestionEvidence {
  sourceClaimId: string;
  sourceStatement: string;
  sourceCardRevision: number;
}
export interface RequirementConflictBoard {
  claims: RequirementClaim[];
  conflicts: RequirementConflict[];
  suggestions: RequirementConflictSuggestion[];
  suggestionsLimited: boolean;
  decisionHistory: RequirementDecision[];
  cardRevisions: Record<string, number>;
  limited: boolean;
}

function explicitModal(text: string): { language: 'en' | 'de'; stance: RequirementStance; rest: string } | null {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('de-DE').replace(/[.,:;!?()]/g, ' ').replace(/\s+/g, ' ').trim();
  const matches = [...normalized.matchAll(/\b(must not|must|darf nicht|muss)\b/g)];
  if (matches.length !== 1 || !matches[0] || matches[0].index === undefined) return null;
  const modal = matches[0][1]!;
  const after = normalized.slice(matches[0].index + modal.length).trim();
  if (modal === 'muss' && after.startsWith('nicht ')) return null; // "Muss nicht" is permission, not prohibition.
  const rest = `${normalized.slice(0, matches[0].index)} ${after}`.replace(/\s+/g, ' ').trim();
  if (rest.split(' ').length < 5 || /\b(?:not|nicht|kein|keine|never|niemals)\b/.test(rest)) return null;
  return { language: modal.startsWith('m') && modal !== 'muss' ? 'en' : modal === 'muss' || modal === 'darf nicht' ? 'de' : 'en',
    stance: modal === 'must not' || modal === 'darf nicht' ? 'forbidden' : 'required', rest };
}

/** Intentionally narrow: same complete sentence except one explicit opposing modal phrase. */
export function explicitOppositeRequirement(a: string, b: string): { first: RequirementStance; second: RequirementStance } | null {
  const first = explicitModal(a);
  const second = explicitModal(b);
  return first && second && first.language === second.language && first.rest === second.rest && first.stance !== second.stance
    ? { first: first.stance, second: second.stance } : null;
}

export function cardRequirementView(board: RequirementConflictBoard, cardId: string): { open: RequirementConflict[]; history: RequirementDecision[] } {
  return {
    open: board.conflicts.filter((item) => (item.left.cardId === cardId || item.right.cardId === cardId) && !item.decision),
    history: board.decisionHistory.filter((item) => item.leftCardId === cardId || item.rightCardId === cardId),
  };
}
