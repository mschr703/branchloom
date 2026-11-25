import { useEffect, useRef, useState } from 'react';
import type { TaskRevisionCleanupPreview, TaskRevisionHistory } from '../../shared/task-revisions';
import type { Card, Session } from '../../shared/types';
import type { Mutate } from './shared';
import './task-revisions.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function deliveryLabel(delivery: string): string {
  switch (delivery) {
    case 'prepared': return 'Bereitgestellt';
    case 'submitting': return 'Zustellung ungeklärt';
    case 'submitted': return 'An Terminal geschrieben';
    case 'included': return 'In neuen Startkontext aufgenommen';
    default: return 'Zustellung ungeklärt';
  }
}

export function TaskCleanupPreview({ preview }: { preview: TaskRevisionCleanupPreview }) {
  return <section className="task-cleanup-preview" aria-label="Bereinigungsprüfung">
    <p className="section-copy">Bis zu zwölf Stichworte je Gruppe aus altem und neuem Aufgabentext, geprüft am {new Date(preview.checkedAt).toLocaleString('de-DE')}. Sie belegen keine obsolete Implementierung. Branchloom löscht nichts.</p>
    <div className="task-cleanup-terms"><p><strong>Im neuen Text weiter genannt:</strong> {preview.retained.join(', ') || 'keine eindeutigen Stichworte'}</p>
      <p><strong>Nur im alten Text:</strong> {preview.oldOnly.map((cue) => cue.term).join(', ') || 'keine eindeutigen Stichworte'}</p>
      <p><strong>Neu genannt:</strong> {preview.newOnly.join(', ') || 'keine eindeutigen Stichworte'}</p></div>
    {preview.oldOnly.length ? <details><summary>Alte Textstellen zu den Suchhinweisen</summary><ul>{preview.oldOnly.map((cue) => <li key={`${cue.source}-${cue.term}`}><strong>{cue.term}</strong> · {cue.source === 'title' ? 'Titel' : 'Beschreibung'}: {cue.excerpt}</li>)}</ul></details> : null}
    {preview.source ? <p className="section-copy">Karten-Worktree: <code>{preview.source.head.slice(0, 10)}</code> · Ziel <code>{preview.source.targetHead.slice(0, 10)}</code> · gemeinsame Basis <code>{preview.source.baseHead.slice(0, 10)}</code> · {preview.source.changedFileCount} geänderte Pfade, {preview.source.inspectedFileCount} lesbare Quelldateien geprüft{preview.source.worktreeDirty ? ' · nicht committierte Änderungen vorhanden' : ''}{preview.source.truncated ? ' · Auswertung begrenzt' : ''}.</p>
      : <p className="section-copy">Für diese Karte ist kein Worktree gespeichert. Es gibt keinen Codebeleg für eine konkrete Bereinigung.</p>}
    {preview.matches.length ? <div className="task-cleanup-matches"><strong>Quellstellen zur manuellen Prüfung</strong><p className="section-copy">Prüfe, ob die Stelle tatsächlich zum entfallenen Umfang gehört. Eine Stichwortübereinstimmung allein rechtfertigt keine Löschung.</p><ul>{preview.matches.map((match) => <li key={`${match.term}-${match.path}-${match.line}`}>
      <span><code>{match.path}:{match.line}</code> · Stichwort „{match.term}“ · SHA-256-Anfang <code title={match.fileHash}>{match.fileHash.slice(0, 12)}</code></span>
      <pre>{match.excerpt}</pre>
    </li>)}</ul></div> : <p className="section-copy">Keine direkte Stichwortstelle in den begrenzt geprüften, geänderten Quelldateien gefunden. Das ist kein Nachweis, dass kein alter Code mehr existiert.</p>}
  </section>;
}

export function TaskRevisionPanel({ card, session, mutate }: { card: Card; session: Session | null; mutate: Mutate }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<TaskRevisionHistory | null>(null);
  const [cleanup, setCleanup] = useState<TaskRevisionCleanupPreview | null>(null);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setOpen(false); setHistory(null); setCleanup(null); setTitle(card.title); setDescription(card.description);
    setReason(''); setError(''); setBusy(false); setCleanupBusy(false);
  }, [card.id]);

  useEffect(() => {
    if (!open) return;
    const request = ++generation.current;
    setCleanup(null); setCleanupBusy(false);
    void window.studio.taskRevisionHistory({ projectId: card.projectId, cardId: card.id })
      .then((value) => { if (request === generation.current) setHistory(value); })
      .catch((error) => { if (request === generation.current) setError(errorText(error)); });
  }, [open, card.id, card.projectId, card.updatedAt, session?.id, session?.state]);

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!history || busy || cleanupBusy || card.archivedAt) return;
    setBusy(true); setError('');
    const result = await mutate(() => window.studio.confirmTaskRevision({ projectId: card.projectId, cardId: card.id,
      expectedContentRevision: history.contentRevision, title, description, reason }));
    if (result) { setHistory(result); setCleanup(null); setReason(''); }
    else {
      setError('Die neue Revision wurde nicht bestätigt. Prüfe den aktuellen Kartenstand und lade den Entwurf neu.');
      try { setHistory(await window.studio.taskRevisionHistory({ projectId: card.projectId, cardId: card.id })); }
      catch { /* The app-level error remains visible. */ }
    }
    setBusy(false);
  }

  async function inspectCleanup(revisionId: string) {
    if (busy || cleanupBusy) return;
    const request = generation.current;
    setCleanupBusy(true); setError(''); setCleanup(null);
    try {
      const result = await window.studio.previewTaskRevisionCleanup({ projectId: card.projectId, cardId: card.id, revisionId });
      if (request === generation.current) setCleanup(result);
    } catch (error) { if (request === generation.current) setError(errorText(error)); }
    finally { if (request === generation.current) setCleanupBusy(false); }
  }

  async function submit(revisionId: string) {
    if (!session || busy || cleanupBusy) return;
    setBusy(true); setError('');
    const result = await mutate(() => window.studio.submitTaskRevision({ projectId: card.projectId,
      cardId: card.id, revisionId, sessionId: session.id }));
    if (result) setHistory(result);
    else {
      setError('Die Zustellung wurde nicht bestätigt. Den gespeicherten Status prüfen; nicht blind erneut senden.');
      try { setHistory(await window.studio.taskRevisionHistory({ projectId: card.projectId, cardId: card.id })); }
      catch { /* The app-level error remains visible. */ }
    }
    setBusy(false);
  }

  const current = history?.revisions[0];
  const canSubmit = Boolean(current && current.delivery === 'prepared' && current.committedContentRevision === history?.contentRevision
    && current.sourceSessionId && current.sourceSessionId === session?.id && session?.state === 'running');

  return <details className="task-revisions" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Auftrag ändern {history?.total ? `· ${history.total} Revisionen` : ''}</summary>
    <div className="task-revisions-content">
      <p className="section-copy">Eine bestätigte Änderung ersetzt den Kartentext und bleibt mit altem Umfang und Grund erhalten. Bestehender Code wird nicht automatisch entfernt.</p>
      <form className="stacked-form" onSubmit={(event) => void confirm(event)}>
        <label>Neuer Titel<input value={title} maxLength={160} required disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Neuer Umfang<textarea value={description} maxLength={6000} rows={4} disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setDescription(event.target.value)} /></label>
        <label>Warum ändert sich der Auftrag?<textarea value={reason} maxLength={1000} rows={2} required disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="task-revisions-actions"><button className="secondary-button small" type="submit" disabled={!history || busy || cleanupBusy || Boolean(card.archivedAt) || !reason.trim() || title.trim() === card.title && description === card.description}>Neue Revision bestätigen</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => { setTitle(card.title); setDescription(card.description); setReason(''); setError(''); }}>Entwurf zurücksetzen</button></div>
      </form>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {history?.revisions.map((item) => <article className="task-revision" key={item.id}>
        <div className="task-revision-heading"><strong>Revision {item.number}</strong><span>{new Date(item.createdAt).toLocaleString('de-DE')}</span><span>{deliveryLabel(item.delivery)}</span></div>
        <p><strong>Grund:</strong> {item.reason}</p>
        <details><summary>Alter und neuer Umfang</summary><div className="task-revision-compare"><div><small>Vorher</small><strong>{item.fromTitle}</strong><p>{item.fromDescription || 'Keine Beschreibung'}</p></div><div><small>Jetzt</small><strong>{item.toTitle}</strong><p>{item.toDescription || 'Keine Beschreibung'}</p></div></div></details>
        {item.targetSessionId ? <small>Sitzung: <code>{item.targetSessionId}</code></small> : null}
        {item.delivery === 'prepared' && item.committedContentRevision !== history.contentRevision ? <p className="inline-note">Diese Revision ist durch eine spätere Kartenänderung überholt.</p> : null}
        {item.delivery === 'prepared' && item.sourceSessionId && (session?.id !== item.sourceSessionId || session.state !== 'running') ? <p className="inline-note">Der ursprüngliche Lauf ist nicht mehr aktiv. Der neue Umfang wird beim nächsten geeigneten Agentenstart als Kontext angeboten.</p> : null}
        {item.id === current?.id && canSubmit ? <button className="secondary-button small" type="button" disabled={busy || cleanupBusy} onClick={() => void submit(item.id)}>An diesen laufenden Agenten senden</button> : null}
        {item.id === current?.id && item.committedContentRevision === history.contentRevision ? <button className="text-button" type="button" disabled={busy || cleanupBusy} onClick={() => void inspectCleanup(item.id)}>{cleanupBusy ? 'Prüfe Quellen…' : 'Bereinigung prüfen'}</button> : null}
        {cleanup?.revisionId === item.id ? <TaskCleanupPreview preview={cleanup} /> : null}
      </article>)}
      {history && history.total > history.revisions.length ? <p className="inline-note">Die neuesten {history.revisions.length} von {history.total} Revisionen werden gezeigt.</p> : null}
      {history?.revisions.some((item) => item.delivery === 'submitted' || item.delivery === 'included') ? <p className="inline-note">Die Zustellung belegt nur PTY-Eingabe oder Startkontext, keine inhaltliche Übernahme durch den Agenten.</p> : null}
    </div>
  </details>;
}
