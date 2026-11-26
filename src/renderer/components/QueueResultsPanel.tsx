import type { QueueResultItem, QueueResultStatus, QueueResults } from '../../shared/queue-results';
import './queue-results.css';

const labels: Record<QueueResultStatus, string> = {
  done: 'Abgeschlossen',
  'needs-attention': 'Prüfung nötig',
  running: 'Läuft',
  skipped: 'Zurückgestellt',
  pending: 'Noch nicht gestartet',
};

function ResultItems({ items, onOpenCard, onOpenSession }: {
  items: QueueResultItem[]; onOpenCard?: (cardId: string) => void; onOpenSession?: (sessionId: string) => void;
}) {
  return <ol>{items.map((item) => {
    const session = item.lastSession;
    return <li key={item.workflowId}>
      <div>
        <span className={`queue-result-signal ${item.status}`} aria-hidden="true" />
        {onOpenCard
          ? <button type="button" className="queue-result-link" onClick={() => onOpenCard(item.cardId)}>{item.cardTitle}</button>
          : <strong>{item.cardTitle}</strong>}
        <span>{labels[item.status]}</span>
      </div>
      <small>
        <a href={`#workflow-${item.workflowId}`}>{item.workflowName}</a> · <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString('de-DE')}</time>
        {session
          ? <> · {onOpenSession
            ? <button type="button" className="queue-result-link" onClick={() => onOpenSession(session.id)}>Sitzung ansehen</button>
            : `Sitzung ${session.state}`}</>
          : ' · Noch keine Sitzung'}
      </small>
    </li>;
  })}</ol>;
}

export function QueueResultsPanel({ results, error, onRetry, onOpenCard, onOpenSession }: {
  results: QueueResults | null; error: string | null; onRetry: () => void;
  onOpenCard?: (cardId: string) => void; onOpenSession?: (sessionId: string) => void;
}) {
  if (!results && !error) return null;
  if (error) return <div className="queue-results">
    <p role="alert">Queue-Ergebnisse konnten nicht geladen werden: {error}</p>
    <button type="button" onClick={onRetry}>Erneut laden</button>
  </div>;
  if (!results || (!results.total && !results.latestActivation)) return null;

  const selectedCounts = results.latestActivation?.counts ?? results.counts;
  return <details className="queue-results">
    <summary>
      <strong>{results.latestActivation ? 'Letzter Queue-Start' : 'Bisherige Queue-Arbeit'}</strong>
      <span>
        {selectedCounts.done} abgeschlossen
        {selectedCounts.running > 0 ? ` · ${selectedCounts.running} laufen` : null}
        {selectedCounts.pending > 0 ? ` · ${selectedCounts.pending} ausstehend` : null}
        {selectedCounts['needs-attention'] > 0 ? ` · ${selectedCounts['needs-attention']} brauchen Prüfung` : null}
        {selectedCounts.skipped > 0 ? ` · ${selectedCounts.skipped} zurückgestellt` : null}
      </span>
    </summary>
    {results.latestActivation ? <div className="queue-results-run">
      <strong>Letzter Start</strong>
      <span><time dateTime={results.latestActivation.startedAt}>{new Date(results.latestActivation.startedAt).toLocaleString('de-DE')}</time>
        {' · '}{results.latestActivation.total} beanspruchte Karten
        {' · '}{results.latestActivation.endedAt ? results.latestActivation.endState === 'off' ? 'beendet' : 'pausiert' : 'läuft'}
      </span>
      {results.latestActivation.total > 0 ? <small>
        {results.latestActivation.counts.done} abgeschlossen
        {' · '}{results.latestActivation.counts['needs-attention']} brauchen Prüfung
        {' · '}{results.latestActivation.counts.skipped} zurückgestellt
        {results.latestActivation.counts.running > 0 ? ` · ${results.latestActivation.counts.running} laufen` : null}
        {results.latestActivation.counts.pending > 0 ? ` · ${results.latestActivation.counts.pending} ausstehend` : null}
      </small> : null}
      {results.latestActivation.runUntil ? <small>Gewähltes Ende: <time dateTime={results.latestActivation.runUntil}>{new Date(results.latestActivation.runUntil).toLocaleString('de-DE')}</time></small> : null}
      {results.latestActivation.continueBlocked ? <small>Unabhängige Karten nach einem Blocker waren zugelassen.</small> : null}
      {results.latestActivation.endReason ? <small>{results.latestActivation.endReason}</small> : null}
    </div> : null}
    <p>Eine abgeschlossene Route ist kein Nachweis für bestandene Tests oder einen Merge. Öffne Karte und Sitzung für die gespeicherten Belege.</p>
    {results.latestActivation
      ? results.latestActivation.total > 0
        ? <><ResultItems items={results.latestItems} onOpenCard={onOpenCard} onOpenSession={onOpenSession} />
          {results.latestTruncated ? <p>Die 100 neuesten Karten dieses Starts werden gezeigt; {results.latestActivation.total} wurden beansprucht.</p> : null}</>
        : <p>Dieser Queue-Start hat noch keine Karte beansprucht.</p>
      : <ResultItems items={results.items} onOpenCard={onOpenCard} onOpenSession={onOpenSession} />}
    {results.latestActivation && results.total > results.latestActivation.total ? <details className="queue-results-history">
      <summary>Gesamte Queue-Historie · {results.total} Karten</summary>
      <ResultItems items={results.items} onOpenCard={onOpenCard} onOpenSession={onOpenSession} />
      {results.truncated ? <p>Die 100 neuesten Queue-Karten werden gezeigt; {results.total} sind insgesamt gespeichert.</p> : null}
    </details> : null}
    {!results.latestActivation && results.truncated ? <p>Die 100 neuesten Queue-Karten werden gezeigt; {results.total} sind insgesamt gespeichert.</p> : null}
  </details>;
}
