import type { Card, CardContextReference, ProjectSnapshot, Session } from '../shared/types';

export interface KnowledgeMapGroup {
  card: Card;
  sessions: Session[];
  references: CardContextReference[];
}

export interface KnowledgeMapPage {
  groups: KnowledgeMapGroup[];
  page: number;
  pages: number;
  totalCards: number;
  totalSessions: number;
  hiddenSessions: number;
  totalReferences: number;
  hiddenReferences: number;
}

const CARDS_PER_PAGE = 4;
const SESSIONS_PER_CARD = 2;
const REFERENCES_PER_CARD = 2;

/** Only saved card IDs are edges. Text similarity never creates a relationship. */
export function projectKnowledgeMapPage(
  snapshot: Pick<ProjectSnapshot, 'project' | 'cards' | 'sessions'>,
  requestedPage = 0,
  references: CardContextReference[] = [],
): KnowledgeMapPage {
  const cards = snapshot.cards.filter((card) => card.projectId === snapshot.project.id);
  const byCard = new Map(cards.map((card) => [card.id, [] as Session[]]));
  const refsByCard = new Map(cards.map((card) => [card.id, [] as CardContextReference[]]));
  for (const session of snapshot.sessions) {
    if (session.projectId !== snapshot.project.id || session.state === 'running' || !session.output.trim()) continue;
    byCard.get(session.cardId)?.push(session);
  }
  for (const reference of references) {
    if (reference.projectId !== snapshot.project.id || !['file', 'folder'].includes(reference.kind)) continue;
    refsByCard.get(reference.cardId)?.push(reference);
  }
  const groups = cards.map((card) => ({
    card,
    sessions: byCard.get(card.id)!.sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt) || a.id.localeCompare(b.id)),
    references: refsByCard.get(card.id)!.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.id.localeCompare(b.id)),
  })).sort((a, b) => Number(b.sessions.length > 0) - Number(a.sessions.length > 0)
    || (b.sessions[0]?.endedAt ?? b.sessions[0]?.startedAt ?? b.card.updatedAt).localeCompare(a.sessions[0]?.endedAt ?? a.sessions[0]?.startedAt ?? a.card.updatedAt)
    || a.card.id.localeCompare(b.card.id));
  const pages = Math.max(1, Math.ceil(groups.length / CARDS_PER_PAGE));
  const page = Number.isFinite(requestedPage) ? Math.max(0, Math.min(pages - 1, Math.floor(requestedPage))) : 0;
  const visible = groups.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);
  return {
    groups: visible.map((group) => ({ card: group.card, sessions: group.sessions.slice(0, SESSIONS_PER_CARD), references: group.references.slice(0, REFERENCES_PER_CARD) })),
    page,
    pages,
    totalCards: groups.length,
    totalSessions: groups.reduce((total, group) => total + group.sessions.length, 0),
    hiddenSessions: visible.reduce((total, group) => total + Math.max(0, group.sessions.length - SESSIONS_PER_CARD), 0),
    totalReferences: visible.reduce((total, group) => total + group.references.length, 0),
    hiddenReferences: visible.reduce((total, group) => total + Math.max(0, group.references.length - REFERENCES_PER_CARD), 0),
  };
}
