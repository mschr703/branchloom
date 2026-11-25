import { useEffect, useRef, useState } from 'react';
import type { TaskRevisionHistory } from '../../shared/task-revisions';
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

export function TaskRevisionPanel({ card, session, mutate }: { card: Card; session: Session | null; mutate: Mutate }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<TaskRevisionHistory | null>(null);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setOpen(false); setHistory(null); setTitle(card.title); setDescription(card.description);
    setReason(''); setError(''); setBusy(false);
  }, [card.id]);

  useEffect(() => {
    if (!open) return;
    const request = ++generation.current;
    void window.studio.taskRevisionHistory({ projectId: card.projectId, cardId: card.id })
      .then((value) => { if (request === generation.current) setHistory(value); })
      .catch((error) => { if (request === generation.current) setError(errorText(error)); });
  }, [open, card.id, card.projectId, card.updatedAt, session?.id, session?.state]);

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!history || busy || card.archivedAt) return;
    setBusy(true); setError('');
    const result = await mutate(() => window.studio.confirmTaskRevision({ projectId: card.projectId, cardId: card.id,
      expectedContentRevision: history.contentRevision, title, description, reason }));
    if (result) { setHistory(result); setReason(''); }
    else {
      setError('Die neue Revision wurde nicht bestätigt. Prüfe den aktuellen Kartenstand und lade den Entwurf neu.');
      try { setHistory(await window.studio.taskRevisionHistory({ projectId: card.projectId, cardId: card.id })); }
      catch { /* The app-level error remains visible. */ }
    }
    setBusy(false);
  }

  async function submit(revisionId: string) {
    if (!session || busy) return;
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
        <div className="task-revisions-actions"><button className="secondary-button small" type="submit" disabled={!history || busy || Boolean(card.archivedAt) || !reason.trim() || title.trim() === card.title && description === card.description}>Neue Revision bestätigen</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => { setTitle(card.title); setDescription(card.description); setReason(''); setError(''); }}>Entwurf zurücksetzen</button></div>
      </form>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {history?.revisions.map((item) => <article className="task-revision" key={item.id}>
        <div className="task-revision-heading"><strong>Revision {item.number}</strong><span>{new Date(item.createdAt).toLocaleString('de-DE')}</span><span>{deliveryLabel(item.delivery)}</span></div>
        <p><strong>Grund:</strong> {item.reason}</p>
        <details><summary>Alter und neuer Umfang</summary><div className="task-revision-compare"><div><small>Vorher</small><strong>{item.fromTitle}</strong><p>{item.fromDescription || 'Keine Beschreibung'}</p></div><div><small>Jetzt</small><strong>{item.toTitle}</strong><p>{item.toDescription || 'Keine Beschreibung'}</p></div></div></details>
        {item.targetSessionId ? <small>Sitzung: <code>{item.targetSessionId}</code></small> : null}
        {item.delivery === 'prepared' && item.committedContentRevision !== history.contentRevision ? <p className="inline-note">Diese Revision ist durch eine spätere Kartenänderung überholt.</p> : null}
        {item.delivery === 'prepared' && item.sourceSessionId && session?.id !== item.sourceSessionId ? <p className="inline-note">Der ursprüngliche Lauf ist nicht mehr aktiv. Der neue Umfang wird beim nächsten geeigneten Agentenstart als Kontext angeboten.</p> : null}
        {item.id === current?.id && canSubmit ? <button className="secondary-button small" type="button" disabled={busy} onClick={() => void submit(item.id)}>An diesen laufenden Agenten senden</button> : null}
      </article>)}
      {history && history.total > history.revisions.length ? <p className="inline-note">Die neuesten {history.revisions.length} von {history.total} Revisionen werden gezeigt.</p> : null}
      {history?.revisions.some((item) => item.delivery === 'submitted' || item.delivery === 'included') ? <p className="inline-note">Die Zustellung belegt nur PTY-Eingabe oder Startkontext, keine inhaltliche Übernahme durch den Agenten.</p> : null}
    </div>
  </details>;
}
