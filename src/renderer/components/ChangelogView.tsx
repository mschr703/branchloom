import { useEffect, useState } from 'react';
import { ArrowUpRight, Clipboard, RefreshCw } from 'lucide-react';
import type { ChangelogCommit, ChangelogPeriod, ChangelogScope, ChangelogSource, ProjectChangelog } from '../../shared/changelog';
import { changelogDigest } from '../changelog-digest';
import './changelog.css';

function displayTime(value: string): string {
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\').replace(/([*_[\]`~])/g, '\\$1');
}

function sourceName(source: ChangelogSource): string {
  return source.kind === 'project-head' ? 'Projekt-HEAD' : `${source.cardTitle || source.cardId || 'Karte'} · ${source.branch || 'Branch unbekannt'}`;
}

type CardWork = { id: string; title: string; commits: ChangelogCommit[] };

/** Only verified source membership is used here; no commit subject is interpreted as a test result. */
export function changelogOverview(changelog: ProjectChangelog): { head: ChangelogCommit[]; worktreeOnly: ChangelogCommit[]; cards: CardWork[] } {
  const head = changelog.commits.filter((commit) => changelog.scope === 'head' || commit.sources?.some((source) => source.kind === 'project-head'));
  const worktreeOnly = changelog.scope === 'saved-worktrees'
    ? changelog.commits.filter((commit) => commit.sources?.some((source) => source.kind === 'card-worktree') && !commit.sources?.some((source) => source.kind === 'project-head')) : [];
  const byCard = new Map<string, CardWork>();
  for (const commit of worktreeOnly) {
    for (const source of commit.sources ?? []) {
      if (source.kind !== 'card-worktree' || !source.cardId) continue;
      const card = byCard.get(source.cardId) ?? { id: source.cardId, title: source.cardTitle || source.cardId, commits: [] };
      card.commits.push(commit);
      byCard.set(source.cardId, card);
    }
  }
  return { head, worktreeOnly, cards: [...byCard.values()] };
}

const qaStatus = { passed: 'Bestanden', failed: 'Mit Fehlern', error: 'Prüffehler' } as const;
const checkoutStatus = { clean: 'sauberer Checkout', dirty: 'Checkout mit Änderungen', changed: 'HEAD während QA geändert', unavailable: 'Gitstand nicht prüfbar', 'not-recorded': 'Gitstand nicht erfasst' } as const;

function integrationStatus(value: ProjectChangelog['integrationReceipts'][number]): string {
  return value.headPresence === 'present' ? 'Im aktuellen Projekt-HEAD nachweisbar'
    : value.headPresence === 'missing' ? 'Nicht mehr im aktuellen Projekt-HEAD' : 'Aktueller Git-Stand nicht prüfbar';
}

function integrationTest(value: ProjectChangelog['integrationReceipts'][number]): string {
  if (!value.test) return 'Kein gespeicherter Integrationstest';
  if (!value.test.matchesSnapshot) return `Testbeleg für anderen Stand (${value.test.scriptName})`;
  return `${value.test.scriptName}: ${value.test.state}${value.test.exitCode === null ? '' : `, Exit ${value.test.exitCode}`}`;
}

export function changelogMarkdown(changelog: ProjectChangelog): string {
  const period = changelog.period === 'day' ? 'Letzte 24 Stunden' : 'Letzte 7 Tage';
  const overview = changelogOverview(changelog);
  const digest = changelogDigest(changelog);
  const lines = [
    `# Changelog · ${period}`,
    '',
    `Zeitraum: ${changelog.since} bis ${changelog.until}`,
    `Quelle: Git-Historie bis HEAD ${changelog.head ?? 'nicht vorhanden'}${changelog.scope === 'saved-worktrees' ? `; dazu ${changelog.checkedWorktrees} verifizierte gespeicherte Karten-Worktrees` : ''}`,
    '',
    '## Überblick',
    `- ${overview.head.length} sichtbare Commits im Projekt-HEAD${changelog.moreAvailable ? ' (begrenzt)' : ''}.`,
    ...(changelog.scope === 'saved-worktrees' ? [`- ${overview.worktreeOnly.length} sichtbare Commits nur in geprüften Karten-Worktrees (${overview.cards.length} Karten).`] : []),
    `- ${changelog.qaTotal} gespeicherte lokale Browser-QA-Berichte und ${changelog.reviewTotal} Diff-Review-Kommentare im Zeitraum; keine Commit-Freigaben.`,
    '',
    '## Karten-Übernahmen',
    ...(changelog.integrationReceipts.length ? changelog.integrationReceipts.map((receipt) =>
      `- ${markdownText(receipt.cardTitle)} (${markdownText(receipt.cardId)}): ${integrationStatus(receipt)}, Ziel ${markdownText(receipt.targetBranch)}, Ergebnis ${receipt.integratedHead ?? 'unbekannt'}, ${receipt.approvalMode ?? 'Modus nicht gespeichert'} am ${receipt.integratedAt}. Diff: ${receipt.review?.matchesSnapshot ? `für diesen Stand geprüft am ${receipt.review.reviewedAt}` : receipt.review ? 'anderer Stand' : 'kein Beleg'}; Test: ${markdownText(integrationTest(receipt))}.`)
      : ['Keine gespeicherte Karten-Übernahme in diesem Zeitraum.']),
    ...(changelog.integrationTotal > changelog.integrationReceipts.length ? [`${changelog.integrationTotal - changelog.integrationReceipts.length} weitere Übernahmebelege sind nicht einzeln aufgeführt.`] : []),
    '',
    '## Zeitlicher Verlauf',
    ...(digest.days.length ? digest.days.flatMap((day) => [
      `### ${markdownText(day.day)}`,
      ...day.entries.map((entry) => `- ${markdownText(entry.at)} · ${entry.kind === 'head' ? 'Projekt-HEAD' : entry.kind === 'worktree' ? 'Karten-Branch' : entry.kind === 'qa' ? 'Browser-QA' : 'Diff-Review'} · ${markdownText(entry.title)} — ${markdownText(entry.detail)} (${markdownText(entry.source)})`),
    ]) : ['Keine Änderungen oder lokalen Prüfspuren in den gewählten Quellen.']),
    ...(digest.hidden ? [`${digest.hidden} weitere Einträge nicht einzeln aufgeführt.`] : []),
    '',
    '## Git-Details',
  ];
  if (changelog.state === 'no-repository') lines.push('Der Projektordner ist kein Git-Repository.');
  else if (changelog.state === 'no-commits') lines.push('Dieses Git-Repository hat noch keinen Commit.');
  else if (!changelog.commits.length) lines.push(changelog.scope === 'head' ? 'In diesem Zeitraum ist kein Commit in HEAD erreichbar.' : 'In diesem Zeitraum wurde in den geprüften Quellen kein Commit gefunden.');
  else for (const commit of changelog.commits) {
    lines.push(`- ${markdownText(commit.subject)} (${commit.hash}, ${commit.committedAt})`);
    if (changelog.scope === 'saved-worktrees') lines.push(`  Quellen: ${(commit.sources ?? []).map((source) => markdownText(sourceName(source))).join('; ')}`);
  }
  if (changelog.moreAvailable) lines.push('', 'Weitere Commits sind vorhanden; die Ansicht zeigt höchstens 100.');
  if (changelog.scope === 'saved-worktrees' && changelog.issues.length) {
    lines.push('', 'Unvollständige Quellen:');
    for (const issue of changelog.issues) lines.push(`- ${markdownText(issue.cardTitle || issue.cardId || 'Weitere Karten-Worktrees')}: ${markdownText(issue.reason)}`);
  }
  if (changelog.qaObservations.length) {
    lines.push('', '## Lokale Browser-QA');
    for (const report of changelog.qaObservations) lines.push(`- ${markdownText(report.cardTitle)}: ${qaStatus[report.status]} (${report.endedAt}, Bericht ${report.id}); ${checkoutStatus[report.checkoutState]}${report.checkoutHead ? ` ${report.checkoutHead}` : ''}.`);
    if (changelog.qaTotal > changelog.qaObservations.length) lines.push(`- ${changelog.qaTotal - changelog.qaObservations.length} weitere Berichte nicht aufgeführt.`);
  }
  if (changelog.reviewActivity.length) {
    lines.push('', '## Diff-Review-Aktivität');
    for (const item of changelog.reviewActivity) lines.push(`- ${markdownText(item.cardTitle)}: ${item.count} Kommentar${item.count === 1 ? '' : 'e'} (zuletzt ${item.lastAt}).`);
    if (changelog.reviewTotal > changelog.reviewActivity.reduce((sum, item) => sum + item.count, 0)) lines.push('- Weitere Kommentare auf anderen Karten nicht aufgeführt.');
  }
  lines.push('', 'QA beobachtet eine lokale Vorschau, deren ausgelieferter Code nicht an einen Commit gebunden ist. Diff-Kommentare sind keine Freigabe. Ein gespeicherter Integrations-Test-/Reviewbeleg gilt nur für die oben ausdrücklich als passend markierte Quell-/Ziel-/Kartenrevision.');
  return lines.join('\n') + '\n';
}

function byLocalDay(commits: ChangelogCommit[]): Array<{ day: string; commits: ChangelogCommit[] }> {
  const groups: Array<{ day: string; commits: ChangelogCommit[] }> = [];
  for (const commit of commits) {
    const day = new Date(commit.committedAt).toLocaleDateString('de-DE', { dateStyle: 'full' });
    const last = groups.at(-1);
    if (last?.day === day) last.commits.push(commit);
    else groups.push({ day, commits: [commit] });
  }
  return groups;
}

export function ChangelogReport({ result, onOpenCard, onOpenQaReport }: { result: ProjectChangelog;
  onOpenCard?: (cardId: string) => void; onOpenQaReport?: (cardId: string, reportId: string) => void }) {
  const overview = changelogOverview(result);
  const digest = changelogDigest(result);
  const headCount = overview.head.length;
  const worktreeCount = overview.worktreeOnly.length;
  return <div className="changelog-report">
    <div className="changelog-source"><span>Erfasst: <time dateTime={result.checkedAt}>{displayTime(result.checkedAt)}</time></span><span>Git HEAD: <code>{result.head?.slice(0, 12) ?? 'nicht vorhanden'}</code></span>{result.moreAvailable ? <span>Git-Historie begrenzt</span> : null}</div>
    {result.issues.length ? <div className="changelog-issues" role="status"><strong>Quellen nur teilweise verfügbar</strong><ul>{result.issues.map((issue, index) => <li key={`${issue.cardId ?? 'all'}:${index}`}><span>{issue.cardTitle || issue.cardId || 'Weitere Karten-Worktrees'}:</span> {issue.reason}</li>)}</ul></div> : null}
    <section className="changelog-deliveries" aria-label="Karten-Übernahmen"><header><h3>Was übernommen wurde</h3><p>Gespeicherte Branchloom-Übernahmen im Zeitraum. Der aktuelle Git-HEAD wird für jeden Beleg erneut geprüft.</p></header>
      {result.integrationReceipts.length ? <ol>{result.integrationReceipts.map((receipt) => <li key={`${receipt.cardId}:${receipt.integratedAt}`} className={receipt.headPresence === 'present' ? 'is-present' : 'is-uncertain'}>
        <div><button type="button" className="changelog-source-link" disabled={!onOpenCard} onClick={() => onOpenCard?.(receipt.cardId)}>{receipt.cardTitle}<ArrowUpRight size={14} aria-hidden="true" /></button><span className="changelog-integration-status">{integrationStatus(receipt)}</span></div>
        <p>{receipt.approvalMode === 'automatic' ? 'Automatisch nach Projektfreigabe' : receipt.approvalMode === 'manual' ? 'Manuell bestätigt' : 'Übernahmemodus nicht gespeichert'} · <time dateTime={receipt.integratedAt}>{displayTime(receipt.integratedAt)}</time> · <code title={receipt.integratedHead ?? undefined}>{receipt.integratedHead?.slice(0, 12) ?? 'Gitstand unbekannt'}</code></p>
        <small>Diff: {receipt.review?.matchesSnapshot ? `für diesen Stand geprüft` : receipt.review ? 'Beleg für anderen Stand' : 'kein Beleg'} · Test: {integrationTest(receipt)}</small>
      </li>)}</ol> : <p className="changelog-empty">Keine gespeicherte Karten-Übernahme in diesem Zeitraum. Der Git-Verlauf steht darunter.</p>}
      {result.integrationTotal > result.integrationReceipts.length ? <p className="changelog-limit">{result.integrationTotal - result.integrationReceipts.length} weitere Übernahmebelege sind nicht einzeln aufgeführt.</p> : null}
    </section>
    <section className="changelog-checks" aria-label="Lokale Prüf- und Reviewspuren"><header><h3>Was geprüft wurde</h3><p>Lokale Browser-QA und Diff-Kommentare bleiben eigenständige Quellen; sie belegen keine Freigabe eines Git-Commits.</p></header>
      {result.qaObservations.length ? <ol>{result.qaObservations.slice(0, 6).map((qa) => <li key={qa.id}><span className={`changelog-check-status changelog-qa-${qa.status}`}>{qaStatus[qa.status]}</span><button type="button" className="changelog-source-link" disabled={!onOpenQaReport} onClick={() => onOpenQaReport?.(qa.cardId, qa.id)}>{qa.cardTitle}<ArrowUpRight size={14} aria-hidden="true" /></button><small><time dateTime={qa.endedAt}>{displayTime(qa.endedAt)}</time> · {checkoutStatus[qa.checkoutState]}</small></li>)}</ol> : <p className="changelog-empty">Keine gespeicherte Browser-QA im Zeitraum.</p>}
      {result.reviewActivity.length ? <div className="changelog-review-line"><strong>Diff-Kommentare</strong>{result.reviewActivity.slice(0, 5).map((review) => <button key={review.cardId} type="button" className="changelog-source-link" disabled={!onOpenCard} onClick={() => onOpenCard?.(review.cardId)}>{review.cardTitle} · {review.count}<ArrowUpRight size={14} aria-hidden="true" /></button>)}</div> : null}
    </section>
    <section className="changelog-digest" aria-label="Zeitlicher Projektüberblick">
      <header><h3>{result.period === 'day' ? 'Die letzten 24 Stunden' : 'Die letzten sieben Tage'}</h3><p>{headCount} {headCount === 1 ? 'Commit' : 'Commits'} im Projekt-HEAD{result.scope === 'saved-worktrees' ? ` · ${worktreeCount} nur in Karten-Worktrees` : ''} · {result.qaTotal} lokale Browser-QA · {result.reviewTotal} Diff-Kommentare</p></header>
      {digest.days.length ? <ol className="changelog-timeline">{digest.days.map((day) => <li key={day.day} className="changelog-day"><h4>{day.day}</h4><ol>{day.entries.map((entry) => <li key={entry.id} className={`changelog-event changelog-event-${entry.kind}${entry.status ? ` changelog-event-${entry.status}` : ''}`}><time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</time><div><span className="changelog-event-kind">{entry.kind === 'head' ? 'Projekt-HEAD' : entry.kind === 'worktree' ? 'Karten-Branch' : entry.kind === 'qa' ? 'Browser-QA' : 'Diff-Review'}</span><strong>{entry.title}</strong><p>{entry.detail}</p><small>{entry.source}</small></div></li>)}</ol></li>)}</ol> : <p className="changelog-empty">{result.state === 'no-repository' ? 'Der Projektordner ist kein Git-Repository.' : result.state === 'no-commits' ? 'Dieses Git-Repository hat noch keinen Commit.' : 'Für diesen Zeitraum liegen in den gewählten Quellen keine Änderungen oder lokalen Prüfspuren vor.'}</p>}
      {digest.hidden ? <p className="changelog-limit">{digest.hidden} weitere Einträge sind in diesem Überblick nicht einzeln aufgeführt.</p> : null}
      {result.qaTotal > result.qaObservations.length || result.reviewTotal > result.reviewActivity.reduce((sum, item) => sum + item.count, 0) ? <p className="changelog-limit">Weitere QA- oder Review-Einträge liegen außerhalb der begrenzten Detailabfrage.</p> : null}
    </section>
    {result.state === 'no-repository' && digest.days.length ? <p className="changelog-empty">Der Projektordner ist kein Git-Repository.</p>
      : result.state === 'no-commits' && digest.days.length ? <p className="changelog-empty">Dieses Git-Repository hat noch keinen Commit.</p>
      : result.commits.length ? <details className="changelog-detail"><summary>Git-Details: {result.commits.length} {result.commits.length === 1 ? 'Commit' : 'Commits'} ansehen</summary><div className="changelog-groups">{byLocalDay(result.commits).map((group, index) => <section key={`${group.day}:${index}`} aria-label={group.day}><h3>{group.day}</h3><ol>{group.commits.map((commit) => <li key={commit.hash}><div className="changelog-subject">{commit.subject}</div><div className="changelog-commit-meta"><time dateTime={commit.committedAt}>{displayTime(commit.committedAt)}</time><code title={commit.hash}>{commit.hash}</code></div>{result.scope === 'saved-worktrees' ? <div className="changelog-provenance" aria-label="Commit-Quellen">{(commit.sources ?? []).map((source, sourceIndex) => <span key={`${source.kind}:${source.cardId ?? ''}:${sourceIndex}`}>{sourceName(source)}</span>)}</div> : null}</li>)}</ol></section>)}</div></details> : null}
    {result.moreAvailable ? <p className="changelog-limit">Weitere Commits sind vorhanden. Die Ansicht zeigt höchstens 100.</p> : null}
    {result.scope === 'saved-worktrees' ? <p className="changelog-worktree-summary changelog-limit">{result.checkedWorktrees} gespeicherte Karten-Worktrees geprüft.</p> : null}
    <p className="changelog-scope">QA beobachtet eine lokale Vorschau; der vom Dev-Server ausgelieferte Code ist keinem Commit nachgewiesen zugeordnet. Diff-Kommentare sind keine Review-Freigabe. Unversionierte Änderungen{result.scope === 'head' ? ' und andere Branches' : ' und nicht gespeicherte Branches'} sind nicht enthalten.</p>
  </div>;
}

export function ChangelogView({ projectId, onOpenCard, onOpenQaReport }: { projectId: string;
  onOpenCard?: (cardId: string) => void; onOpenQaReport?: (cardId: string, reportId: string) => void }) {
  const [period, setPeriod] = useState<ChangelogPeriod>('week');
  const [scope, setScope] = useState<ChangelogScope>('head');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<ProjectChangelog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(''); setCopied(false); setResult(null);
    void window.studio.projectChangelog({ projectId, period, scope })
      .then((value) => { if (live) setResult(value); })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId, period, scope, refresh]);

  async function copy() {
    if (!result || loading) return;
    try { await navigator.clipboard.writeText(changelogMarkdown(result)); setCopied(true); setError(''); }
    catch { setError('Changelog konnte nicht in die Zwischenablage kopiert werden.'); }
  }

  return <section className="standard-page changelog-page" aria-label="Changelog">
    <div className="view-header"><div><h2>Changelog</h2><p>Was im Projekt-HEAD ankam, woran Karten-Branches arbeiten und welche lokalen Prüfspuren vorliegen.</p></div></div>
    <div className="changelog-controls">
      <label>Zeitraum<select value={period} onChange={(event) => setPeriod(event.target.value as ChangelogPeriod)}><option value="day">Letzte 24 Stunden</option><option value="week">Letzte 7 Tage</option></select></label>
      <label>Quellen<select value={scope} onChange={(event) => setScope(event.target.value as ChangelogScope)}><option value="head">Nur Projekt-HEAD</option><option value="saved-worktrees">Projekt-HEAD + Karten-Worktrees</option></select></label>
      <button type="button" className="secondary-button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}><RefreshCw size={15} aria-hidden="true" /> Aktualisieren</button>
      <button type="button" className="secondary-button" onClick={() => void copy()} disabled={!result || loading}><Clipboard size={15} aria-hidden="true" /> {copied ? 'Markdown kopiert' : 'Markdown kopieren'}</button>
    </div>
    {loading ? <p role="status">Git-Historie wird gelesen…</p> : error ? <p className="changelog-error" role="alert">{error}</p> : result ? <ChangelogReport result={result} onOpenCard={onOpenCard} onOpenQaReport={onOpenQaReport} /> : null}
  </section>;
}
