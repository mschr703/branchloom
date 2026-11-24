import type { ChangelogCommit, ProjectChangelog } from '../shared/changelog';

export type DigestEntry = {
  id: string;
  kind: 'head' | 'worktree' | 'qa' | 'review';
  at: string;
  title: string;
  detail: string;
  source: string;
  status?: 'passed' | 'failed' | 'error';
};

export type DigestDay = { day: string; entries: DigestEntry[] };
export type ChangelogDigest = { days: DigestDay[]; hidden: number; visible: number };

function inProjectHead(commit: ChangelogCommit, scope: ProjectChangelog['scope']): boolean {
  return scope === 'head' || commit.sources?.some((source) => source.kind === 'project-head') === true;
}

/** A chronology of recorded sources, not an inferred story of completed work. */
export function changelogDigest(result: ProjectChangelog, limit = 18): ChangelogDigest {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Digest limit must be a positive integer.');
  const entries: DigestEntry[] = result.commits.map((commit) => {
    const head = inProjectHead(commit, result.scope);
    const cards = [...new Set((commit.sources ?? []).filter((source) => source.kind === 'card-worktree')
      .map((source) => source.cardTitle || source.cardId || 'Karte'))];
    return { id: `commit:${commit.hash}`, kind: head ? 'head' : 'worktree', at: commit.committedAt,
      title: commit.subject, detail: head ? 'Im aktuellen Projekt-HEAD erreichbar' : 'Nur in geprüftem Karten-Worktree',
      source: cards.length && !head ? cards.slice(0, 2).join(', ') + (cards.length > 2 ? ` und ${cards.length - 2} weitere` : '') : commit.hash.slice(0, 8) };
  });
  for (const qa of result.qaObservations) entries.push({
    id: `qa:${qa.id}`, kind: 'qa', at: qa.endedAt, title: qa.cardTitle,
    detail: qa.status === 'passed' ? 'Lokale Browser-QA bestanden' : qa.status === 'failed' ? 'Lokale Browser-QA mit Fehlern' : 'Lokale Browser-QA mit Prüffehler',
    source: `Bericht ${qa.id} · Vorschau nicht an Commit gebunden`, status: qa.status,
  });
  for (const review of result.reviewActivity) entries.push({
    id: `review:${review.cardId}`, kind: 'review', at: review.lastAt, title: review.cardTitle,
    detail: `${review.count} Diff-Kommentar${review.count === 1 ? '' : 'e'} · keine Freigabe`, source: 'Gespeicherte Review-Aktivität',
  });
  entries.sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || left.id.localeCompare(right.id));
  const shown = entries.slice(0, limit);
  const days: DigestDay[] = [];
  for (const entry of shown) {
    const day = new Date(entry.at).toLocaleDateString('de-DE', { dateStyle: 'full' });
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return { days, hidden: entries.length - shown.length, visible: shown.length };
}
