import type { QueueResultStatus, QueueResults } from '../../shared/queue-results';
import './queue-results.css';

const labels: Record<QueueResultStatus, string> = {
  done: 'Abgeschlossen',
  'needs-attention': 'Prüfung nötig',
  running: 'Läuft',
  skipped: 'Zurückgestellt',
  pending: 'Noch nicht gestartet',
};

export function QueueResultsPanel({ results, error, onRetry, onOpenCard, onOpenSession }: {
  results: QueueResults | null; error: string | null; onRetry: () => void;
  onOpenCard?: (cardId: string) => void; onOpenSession?: (sessionId: string) => void;
}) {
  if (!results && !error) return null;
  if (error) return <div className="queue-results">
    <p role="alert">Queue-Ergebnisse konnten nicht geladen werden: {error}</p>
    <button type="button" onClick={onRetry}>Erneut laden</button>
  </div>;
  if (!results?.total) return null;

  return <details className="queue-results">
    <summary>
      <strong>Bisherige Queue-Arbeit</strong>
      <span>
        {results.counts.done} abgeschlossen
        {results.counts.running > 0 ? ` · ${results.counts.running} laufen` : null}
        {results.counts.pending > 0 ? ` · ${results.counts.pending} ausstehend` : null}
        {results.counts['needs-attention'] > 0 ? ` · ${results.counts['needs-attention']} brauchen Prüfung` : null}
        {results.counts.skipped > 0 ? ` · ${results.counts.skipped} zurückgestellt` : null}
      </span>
    </summary>
    <p>Gespeicherte Karten und Workflow-Belege dieses Projekts, über alle Queue-Starts hinweg. Eine abgeschlossene Route ist kein Nachweis für bestandene Tests oder einen Merge.</p>
    <ol>{results.items.map((item) => {
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
    </li>; })}</ol>
    {results.truncated ? <p>Die 100 neuesten Queue-Karten werden gezeigt; {results.total} sind insgesamt gespeichert.</p> : null}
  </details>;
}
