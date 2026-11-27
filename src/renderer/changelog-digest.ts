import type { ChangelogCommit, ProjectChangelog } from '../shared/changelog';

export type DigestEntry = {
  id: string;
  kind: 'head' | 'worktree' | 'qa' | 'review' | 'integration';
  at: string;
  title: string;
  detail: string;
  source: string;
  authorName?: string;
  cardId?: string;
  qaReportId?: string;
  commitHash?: string;
  status?: 'passed' | 'failed' | 'error';
};

export type DigestDay = { day: string; entries: DigestEntry[] };
export type ChangelogDigest = { days: DigestDay[]; hidden: number; visible: number };
export type ChangelogEventFilter = 'all' | 'code' | 'integration' | 'qa' | 'review';

function inProjectHead(commit: ChangelogCommit, scope: ProjectChangelog['scope']): boolean {
  return scope === 'head' || commit.sources?.some((source) => source.kind === 'project-head') === true;
}

/** A chronology of recorded sources, not an inferred story of completed work. */
export function changelogDigest(result: ProjectChangelog, limit = 18,
  filter: { kind?: ChangelogEventFilter; gitAuthor?: string } = {}): ChangelogDigest {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Digest limit must be a positive integer.');
  const entries: DigestEntry[] = result.commits.map((commit) => {
    const head = inProjectHead(commit, result.scope);
    const cards = [...new Set((commit.sources ?? []).filter((source) => source.kind === 'card-worktree')
      .map((source) => source.cardTitle || source.cardId || 'Karte'))];
    return { id: `commit:${commit.hash}`, kind: head ? 'head' : 'worktree', at: commit.committedAt,
      title: commit.subject, detail: head ? 'Im aktuellen Projekt-HEAD erreichbar' : 'Nur in geprüftem Karten-Worktree',
      source: cards.length && !head ? cards.slice(0, 2).join(', ') + (cards.length > 2 ? ` und ${cards.length - 2} weitere` : '') : commit.hash.slice(0, 8),
      authorName: commit.authorName, commitHash: commit.hash };
  });
  for (const qa of result.qaObservations) entries.push({
    id: `qa:${qa.id}`, kind: 'qa', at: qa.endedAt, title: qa.cardTitle,
    detail: qa.status === 'passed' ? 'Lokale Browser-QA bestanden' : qa.status === 'failed' ? 'Lokale Browser-QA mit Fehlern' : 'Lokale Browser-QA mit Prüffehler',
    source: `Bericht ${qa.id} · Vorschau nicht an Commit gebunden`, status: qa.status,
    cardId: qa.cardId, qaReportId: qa.id,
  });
  for (const review of result.reviewActivity) entries.push({
    id: `review:${review.cardId}`, kind: 'review', at: review.lastAt, title: review.cardTitle,
    detail: `${review.count} Diff-Kommentar${review.count === 1 ? '' : 'e'} · keine Freigabe`, source: 'Gespeicherte Review-Aktivität',
    cardId: review.cardId,
  });
  for (const receipt of result.integrationReceipts) entries.push({
    id: `integration:${receipt.cardId}:${receipt.integratedAt}`, kind: 'integration', at: receipt.integratedAt,
    title: receipt.cardTitle,
    detail: receipt.headPresence === 'present' ? 'Übernahmebeleg · im aktuellen Projekt-HEAD erreichbar'
      : receipt.headPresence === 'missing' ? 'Übernahmebeleg · nicht mehr im aktuellen Projekt-HEAD'
        : 'Übernahmebeleg · aktueller Git-Stand nicht prüfbar',
    source: `${receipt.targetBranch} · ${receipt.integratedHead?.slice(0, 8) ?? 'Gitstand unbekannt'}`,
    cardId: receipt.cardId,
  });
  const selected = entries.filter((entry) => {
    if (filter.gitAuthor && (entry.kind !== 'head' && entry.kind !== 'worktree' || entry.authorName !== filter.gitAuthor)) return false;
    if (!filter.kind || filter.kind === 'all') return true;
    return filter.kind === 'code' ? entry.kind === 'head' || entry.kind === 'worktree' : entry.kind === filter.kind;
  });
  selected.sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || left.id.localeCompare(right.id));
  const shown = selected.slice(0, limit);
  const days: DigestDay[] = [];
  for (const entry of shown) {
    const day = new Date(entry.at).toLocaleDateString('de-DE', { dateStyle: 'full' });
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return { days, hidden: selected.length - shown.length, visible: shown.length };
}
