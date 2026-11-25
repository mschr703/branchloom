import { useEffect, useState } from 'react';
import { integrationResultsMarkdown, type IntegrationResultFolder as Folder } from '../../shared/integration-results';
import type { IntegrationState } from '../../shared/integration-queue';

interface Props { projectId: string; queueRevision: string }
const gitStatus = {
  present: 'Commit im aktuellen Ziel nachweisbar',
  missing: 'Commit im aktuellen Ziel nicht vorhanden',
  unverified: 'Aktuelles Git-Ziel nicht prüfbar',
} as const;
const stateNames: Record<IntegrationState, string> = {
  queued: 'Wartet', ready: 'Bereit', blocked: 'Blockiert', integrating: 'Git-Ausgang wird geprüft', integrated: 'Übernommen',
};
const testNames: Record<string, string> = {
  running: 'läuft', passed: 'bestanden', failed: 'fehlgeschlagen', interrupted: 'unterbrochen', stale: 'ungültig',
};

/** Compact on-demand view of actual integration receipts, not a second copy of the queue controls. */
export function IntegrationResultFolder({ projectId, queueRevision }: Props) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setFolder(null); setCopied(false); setError('');
    void window.studio.integrationResultFolder(projectId)
      .then((value) => { if (active) setFolder(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, projectId, queueRevision]);

  async function copyMarkdown() {
    if (!folder || loading) return;
    try { await navigator.clipboard.writeText(integrationResultsMarkdown(folder)); setCopied(true); setError(''); }
    catch { setError('Die Ergebnismappe konnte nicht kopiert werden.'); }
  }

  const integrated = folder?.entries.filter((entry) => entry.state === 'integrated') ?? [];
  const pending = folder?.entries.filter((entry) => entry.state !== 'integrated') ?? [];
  return <details className="integration-results" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Ergebnismappe {folder ? `· ${integrated.length} übernommen, ${pending.length} offen` : ''}</summary>
    {open ? <div className="integration-results-body">
      <div className="integration-results-actions">
        <small>Gespeicherte Queue-, Review- und Testbelege. Git wird beim Öffnen für übernommene Commits neu geprüft.</small>
        <button type="button" className="text-button" disabled={!folder || loading} onClick={() => void copyMarkdown()}>{copied ? 'Markdown kopiert' : 'Markdown kopieren'}</button>
      </div>
      {loading ? <p className="inline-note" role="status">Ergebnisse werden geprüft…</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {!loading && folder ? <>
        {folder.omittedCount ? <p className="inline-note">{folder.omittedCount} ältere Einträge sind in dieser Ansicht nicht enthalten.</p> : null}
        <h5>Übernommen</h5>
        {integrated.length ? <ol>{integrated.map((entry) => <li key={entry.cardId}>
          <strong>{entry.title}</strong><span><code title={entry.sourceHead}>{entry.sourceHead.slice(0, 12)}</code> → {entry.targetBranch} · {entry.approvalMode === 'automatic' ? 'automatisch' : entry.approvalMode === 'manual' ? 'manuell' : 'Freigabe nicht gespeichert'}</span>
          <small>{entry.gitPresence ? gitStatus[entry.gitPresence] : 'Git nicht geprüft'} · Review {entry.review?.matchesSavedSnapshot ? 'belegt' : entry.review ? 'anderer Stand' : 'ohne Beleg'} · Test {entry.test?.matchesSavedSnapshot && entry.test.state === 'passed' ? `bestanden (${entry.test.scriptName})` : entry.test ? testNames[entry.test.state] ?? entry.test.state : 'ohne Beleg'}</small>
        </li>)}</ol> : <p className="inline-note">Noch keine Karte übernommen.</p>}
        <h5>Offen</h5>
        {pending.length ? <ol>{pending.map((entry) => <li key={entry.cardId}>
          <strong>{entry.title}</strong><span>{stateNames[entry.state]} · {entry.targetBranch} · <code title={entry.sourceHead}>{entry.sourceHead.slice(0, 12)}</code></span>
          <small>{entry.reason ?? 'Wartet auf den nächsten Prüfschritt.'}</small>
        </li>)}</ol> : <p className="inline-note">Keine offenen Integrationen.</p>}
      </> : null}
    </div> : null}
  </details>;
}
