import { useEffect, useRef, useState } from 'react';
import type { QueueResultItem, QueueResultStatus, QueueResults } from '../../shared/queue-results';
import { queueResultsMarkdown } from '../../shared/queue-results-markdown';
import './queue-results.css';

const labels: Record<QueueResultStatus, string> = {
  done: 'Abgeschlossen',
  'needs-attention': 'Prüfung nötig',
  running: 'Läuft',
  skipped: 'Zurückgestellt',
  pending: 'Noch nicht gestartet',
};
const testLabels = { running: 'läuft', passed: 'bestanden', failed: 'fehlgeschlagen',
  interrupted: 'unterbrochen', stale: 'veraltet' } as const;
const integrationLabels = { queued: 'vorgemerkt', ready: 'bereit', blocked: 'blockiert',
  integrating: 'wird übernommen', integrated: 'übernommen' } as const;
const qaLabels = { passed: 'bestanden', failed: 'mit Fehlern', error: 'nicht prüfbar' } as const;

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
      {item.test ? <small title={`Testbeleg #${item.test.id} · Quell-Commit ${item.test.sourceHead} · Ziel-Commit ${item.test.targetHead}`}>
        Gespeicherter Test #{item.test.id}: npm run {item.test.scriptName} · {testLabels[item.test.state]}
        {item.test.endedAt ? <> · <time dateTime={item.test.endedAt}>{new Date(item.test.endedAt).toLocaleString('de-DE')}</time></> : null}
        {' · '}{item.test.queueActivationId
          ? item.test.queueActivationId === item.activationId ? 'im Kartenstart' : `Queue-Start ${item.test.queueActivationId.slice(0, 8)}`
          : 'ohne Queue-Startbeleg'}
      </small> : null}
      {item.review ? <small title={`Diff-Review · Quell-Commit ${item.review.sourceHead} · Ziel-Commit ${item.review.targetHead}`}>
        Gespeicherter Diff-Review · <time dateTime={item.review.reviewedAt}>{new Date(item.review.reviewedAt).toLocaleString('de-DE')}</time>
        {' · '}{item.review.matchesSavedIntegration ? 'passt zum gespeicherten Integrationsstand' : 'frühere vorbereitete Revision'}
      </small> : null}
      {item.qa ? <small title={`Browser-QA-Beleg ${item.qa.id} · DOM-Prüfung ${item.qa.pageCheck}`}>
        Gespeicherte Browser-QA {item.qa.id.slice(0, 8)} · {qaLabels[item.qa.status]}
        {item.qa.viewportWidth > 0 && item.qa.viewportHeight > 0 ? ` · ${item.qa.viewportWidth} × ${item.qa.viewportHeight} px` : ''}
        {' · '}<time dateTime={item.qa.endedAt}>{new Date(item.qa.endedAt).toLocaleString('de-DE')}</time>
      </small> : null}
      {item.integration ? <small title={`Integrationsbeleg #${item.integration.id} · Quell-Commit ${item.integration.sourceHead}${item.integration.integratedHead ? ` · gespeicherter Ziel-Commit ${item.integration.integratedHead}` : ''}`}>
        Gespeicherte Integration #{item.integration.id}: {integrationLabels[item.integration.state]} · Ziel {item.integration.targetBranch}
        {item.integration.approvalMode ? ` · ${item.integration.approvalMode === 'automatic' ? 'Projekt-Automatik' : 'manuell'}` : null}
      </small> : null}
    </li>;
  })}</ol>;
}

export function QueueResultsPanel({ results, error, onRetry, onOpenCard, onOpenSession }: {
  results: QueueResults | null; error: string | null; onRetry: () => void;
  onOpenCard?: (cardId: string) => void; onOpenSession?: (sessionId: string) => void;
}) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const projectRef = useRef(results?.projectId);
  projectRef.current = results?.projectId;
  useEffect(() => { setCopying(false); setCopied(false); setCopyError(''); }, [results?.projectId]);
  async function copyLatest() {
    if (!results || copying) return;
    const projectId = results.projectId;
    setCopying(true); setCopied(false); setCopyError('');
    try {
      const fresh = await window.studio.queueResults(projectId);
      if (projectRef.current !== projectId) return;
      await navigator.clipboard.writeText(queueResultsMarkdown(fresh));
      if (projectRef.current === projectId) setCopied(true);
    } catch { if (projectRef.current === projectId) setCopyError('Die Queue-Zusammenfassung konnte nicht kopiert werden.'); }
    finally { if (projectRef.current === projectId) setCopying(false); }
  }
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
      <button type="button" className="text-button" disabled={copying} onClick={() => void copyLatest()}>
        {copying ? 'Lade aktuellen Stand …' : copied ? 'Zusammenfassung kopiert' : 'Zusammenfassung kopieren'}
      </button>
    </div> : null}
    {copyError ? <p role="alert">{copyError}</p> : null}
    <p>Eine abgeschlossene Route ist kein Test- oder Merge-Nachweis. Test-, Review-, Browser-QA- und Integrationsangaben sind gespeicherte Kartenbelege; ihr heutiger Git-Stand und die vom Dev-Server ausgelieferte Codeversion werden hier nicht erneut geprüft. Öffne die Karte für die aktuelle Prüfung.</p>
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
