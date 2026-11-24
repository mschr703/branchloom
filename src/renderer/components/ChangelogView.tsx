import { useEffect, useState } from 'react';
import { Clipboard, RefreshCw } from 'lucide-react';
import type { ChangelogCommit, ChangelogPeriod, ChangelogScope, ChangelogSource, ProjectChangelog } from '../../shared/changelog';
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

export function changelogMarkdown(changelog: ProjectChangelog): string {
  const period = changelog.period === 'day' ? 'Letzte 24 Stunden' : 'Letzte 7 Tage';
  const overview = changelogOverview(changelog);
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
  lines.push('', 'QA beobachtet eine lokale Vorschau, deren ausgelieferter Code nicht an einen Commit gebunden ist. Diff-Kommentare sind keine Freigabe. Tests und Reviews sind hier keinem Commit als Ergebnis zugeordnet.');
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

export function ChangelogReport({ result }: { result: ProjectChangelog }) {
  const overview = changelogOverview(result);
  const headCount = overview.head.length;
  const worktreeCount = overview.worktreeOnly.length;
  const visibleQa = result.qaObservations.slice(0, 5);
  const visibleReviews = result.reviewActivity.slice(0, 5);
  return <div className="changelog-report">
    <div className="changelog-source"><span>Erfasst: <time dateTime={result.checkedAt}>{displayTime(result.checkedAt)}</time></span><span>Git HEAD: <code>{result.head?.slice(0, 12) ?? 'nicht vorhanden'}</code></span>{result.moreAvailable ? <span>Git-Historie begrenzt</span> : null}</div>
    {result.issues.length ? <div className="changelog-issues" role="status"><strong>Quellen nur teilweise verfügbar</strong><ul>{result.issues.map((issue, index) => <li key={`${issue.cardId ?? 'all'}:${index}`}><span>{issue.cardTitle || issue.cardId || 'Weitere Karten-Worktrees'}:</span> {issue.reason}</li>)}</ul></div> : null}
    <section className="changelog-overview" aria-label="Überblick über den Zeitraum">
      <h3>Was sich im Zeitraum getan hat</h3>
      <p>{headCount ? `${headCount} sichtbare ${headCount === 1 ? 'Commit ist' : 'Commits sind'} im aktuellen Projekt-HEAD erreichbar.` : 'Im aktuellen Projekt-HEAD liegt für diesen Zeitraum kein sichtbarer Commit.'}{result.scope === 'saved-worktrees' && worktreeCount ? ` ${worktreeCount} weitere sichtbare ${worktreeCount === 1 ? 'Commit liegt' : 'Commits liegen'} nur in geprüften Karten-Worktrees.` : ''}</p>
      <div className="changelog-evidence-line"><span><strong>{headCount}</strong> Projekt-HEAD</span>{result.scope === 'saved-worktrees' ? <span><strong>{worktreeCount}</strong> nur Karten-Worktrees</span> : null}<span><strong>{result.qaTotal}</strong> lokale Browser-QA</span><span><strong>{result.reviewTotal}</strong> Diff-Kommentare</span></div>
    </section>
    {overview.head.length ? <section className="changelog-editorial" aria-label="Letzte Änderungen im Projekt-HEAD"><h3>Im Projekt-HEAD</h3><ol>{overview.head.slice(0, 4).map((commit) => <li key={commit.hash}><span>{commit.subject}</span><code title={commit.hash}>{commit.hash.slice(0, 8)}</code></li>)}</ol>{overview.head.length > 4 ? <p>{overview.head.length - 4} weitere im Git-Detail.</p> : null}</section> : null}
    {result.scope === 'saved-worktrees' ? <section className="changelog-editorial" aria-label="Arbeit in Karten-Worktrees"><h3>Auf Karten-Branches</h3>{overview.cards.length ? <><p>Diese Commits sind im geprüften Projekt-HEAD nicht enthalten.</p><ol>{overview.cards.slice(0, 8).map((card) => <li key={card.id}><span><strong>{card.title}</strong><small>{card.commits[0]?.subject}</small></span><span className="changelog-count">{card.commits.length} {card.commits.length === 1 ? 'Commit' : 'Commits'}</span></li>)}</ol>{overview.cards.length > 8 ? <p>{overview.cards.length - 8} weitere Karten im Git-Detail.</p> : null}</> : <p>Kein zusätzlicher Commit in den geprüften Karten-Worktrees.</p>}<p className="changelog-worktree-summary">{result.checkedWorktrees} gespeicherte Karten-Worktrees geprüft.</p></section> : null}
    {(result.qaTotal || result.reviewTotal) ? <section className="changelog-evidence" aria-label="Gespeicherte Prüf- und Review-Spuren"><h3>Prüf- und Review-Spuren</h3><p>Lokale Beobachtungen zu Karten; keine Freigabe eines Git-Commits.</p>{visibleQa.length ? <div className="changelog-evidence-group"><h4>Browser-QA</h4><ol>{visibleQa.map((report) => <li key={report.id}><span className={`changelog-qa-status changelog-qa-${report.status}`}>{qaStatus[report.status]}</span><span><strong>{report.cardTitle}</strong><small><time dateTime={report.endedAt}>{displayTime(report.endedAt)}</time> · {checkoutStatus[report.checkoutState]}{report.checkoutHead ? ` ${report.checkoutHead.slice(0, 8)}` : ''}</small></span></li>)}</ol>{result.qaTotal > visibleQa.length ? <p>Weitere Berichte sind im Überblick gezählt; Markdown führt höchstens 20 einzeln auf.</p> : null}</div> : null}{visibleReviews.length ? <div className="changelog-evidence-group"><h4>Diff-Kommentare</h4><ol>{visibleReviews.map((item) => <li key={item.cardId}><span><strong>{item.cardTitle}</strong><small>Zuletzt <time dateTime={item.lastAt}>{displayTime(item.lastAt)}</time></small></span><span className="changelog-count">{item.count} {item.count === 1 ? 'Kommentar' : 'Kommentare'}</span></li>)}</ol>{result.reviewActivity.length > visibleReviews.length ? <p>Weitere Karten sind im Markdown aufgeführt, höchstens zehn einzeln.</p> : null}</div> : null}</section> : null}
    {result.state === 'no-repository' ? <p className="changelog-empty">Der Projektordner ist kein Git-Repository.</p>
      : result.state === 'no-commits' ? <p className="changelog-empty">Dieses Git-Repository hat noch keinen Commit.</p>
      : result.commits.length === 0 ? <p className="changelog-empty">{result.scope === 'head' ? 'In diesem Zeitraum ist kein Commit in HEAD erreichbar.' : 'In diesem Zeitraum wurde in den geprüften Quellen kein Commit gefunden.'}</p>
      : <details className="changelog-detail"><summary>Git-Details: {result.commits.length} {result.commits.length === 1 ? 'Commit' : 'Commits'} ansehen</summary><div className="changelog-groups">{byLocalDay(result.commits).map((group, index) => <section key={`${group.day}:${index}`} aria-label={group.day}><h3>{group.day}</h3><ol>{group.commits.map((commit) => <li key={commit.hash}><div className="changelog-subject">{commit.subject}</div><div className="changelog-commit-meta"><time dateTime={commit.committedAt}>{displayTime(commit.committedAt)}</time><code title={commit.hash}>{commit.hash}</code></div>{result.scope === 'saved-worktrees' ? <div className="changelog-provenance" aria-label="Commit-Quellen">{(commit.sources ?? []).map((source, sourceIndex) => <span key={`${source.kind}:${source.cardId ?? ''}:${sourceIndex}`}>{sourceName(source)}</span>)}</div> : null}</li>)}</ol></section>)}</div></details>}
    {result.moreAvailable ? <p className="changelog-limit">Weitere Commits sind vorhanden. Die Ansicht zeigt höchstens 100.</p> : null}
    <p className="changelog-scope">QA beobachtet eine lokale Vorschau; der vom Dev-Server ausgelieferte Code ist keinem Commit nachgewiesen zugeordnet. Diff-Kommentare sind keine Review-Freigabe. Unversionierte Änderungen{result.scope === 'head' ? ' und andere Branches' : ' und nicht gespeicherte Branches'} sind nicht enthalten.</p>
  </div>;
}

export function ChangelogView({ projectId }: { projectId: string }) {
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
    {loading ? <p role="status">Git-Historie wird gelesen…</p> : error ? <p className="changelog-error" role="alert">{error}</p> : result ? <ChangelogReport result={result} /> : null}
  </section>;
}
