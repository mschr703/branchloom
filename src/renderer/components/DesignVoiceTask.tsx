import { useEffect, useRef, useState } from 'react';
import type { DesignSelection } from '../../shared/design-inspection';
import type { CardDesignContextCandidate, Column, QueueState } from '../../shared/types';

const errorText = (reason: unknown): string => {
  if (reason && typeof reason === 'object' && 'name' in reason && (reason.name === 'NotAllowedError' || reason.name === 'PermissionDeniedError')) return 'Mikrofonzugriff wurde abgelehnt. Du kannst den Wunsch eintippen.';
  return reason instanceof Error ? reason.message : String(reason);
};

export function DesignVoiceTask({ projectId, selection, prefillDescription = '', columns, queueState, onOpenCard, onCreated, onCancel }: {
  projectId: string; selection: DesignSelection; columns: Column[]; queueState: QueueState;
  prefillDescription?: string;
  onOpenCard: (cardId: string) => void | Promise<void>; onCreated: () => void | Promise<void>; onCancel: () => void;
}) {
  const [candidate, setCandidate] = useState<CardDesignContextCandidate | null>(null);
  const [title, setTitle] = useState(`Design: ${selection.selector}`.slice(0, 160));
  const [description, setDescription] = useState(prefillDescription);
  const [columnId, setColumnId] = useState(() => columns.find((column) => column.name.toLowerCase() === 'to do')?.id ?? columns[0]?.id ?? '');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupRecording = () => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    const current = recorder.current;
    recorder.current = null;
    if (current) {
      current.onstop = null; current.ondataavailable = null; current.onerror = null;
      if (current.state !== 'inactive') current.stop();
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void window.studio.designTaskCandidate({ projectId, selectionId: selection.id })
      .then((value) => { if (!cancelled) setCandidate(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(errorText(reason)); });
    return () => { cancelled = true; active.current = false; generation.current += 1; cleanupRecording(); };
  }, [projectId, selection.id]);

  async function startRecording() {
    if (recording || transcribing || saving || createdId) return;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Mikrofonaufnahme ist hier nicht verfügbar. Du kannst den Wunsch eintippen.'); return; }
    const token = ++generation.current;
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current || generation.current !== token) { opened.getTracks().forEach((track) => track.stop()); return; }
      stream.current = opened;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(opened, preferred ? { mimeType: preferred } : undefined);
      recorder.current = current;
      const chunks: Blob[] = [];
      current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      current.onerror = () => { if (active.current && generation.current === token) setError('Die Aufnahme ist fehlgeschlagen.'); cleanupRecording(); setRecording(false); };
      current.onstop = async () => {
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = null;
        opened.getTracks().forEach((track) => track.stop());
        stream.current = null; recorder.current = null;
        if (!active.current || generation.current !== token) return;
        setRecording(false);
        if (!chunks.length) { setError('Die Aufnahme ist leer.'); return; }
        setTranscribing(true);
        try {
          const bytes = new Uint8Array(await new Blob(chunks, { type: current.mimeType }).arrayBuffer());
          if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Aufnahme ist zu groß (maximal 8 MiB).');
          if (!active.current || generation.current !== token) return;
          const transcript = (await window.studio.transcribe(bytes)).trim();
          if (active.current && generation.current === token) setDescription((old) => [old.trim(), transcript].filter(Boolean).join('\n'));
        } catch (reason) { if (active.current && generation.current === token) setError(errorText(reason)); }
        finally { if (active.current && generation.current === token) setTranscribing(false); }
      };
      current.start(250);
      timeout.current = setTimeout(() => { if (current.state === 'recording') current.stop(); }, 60_000);
      setRecording(true);
    } catch (reason) {
      cleanupRecording();
      if (active.current && generation.current === token) setError(errorText(reason));
    }
  }

  function cancel() {
    generation.current += 1;
    cleanupRecording();
    onCancel();
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!candidate || saving || recording || transcribing || createdId || queueState === 'running') return;
    setSaving(true); setError('');
    try {
      const card = await window.studio.createCardFromDesignRequest({ projectId, selectionId: selection.id, expectedFingerprint: candidate.fingerprint, columnId, title: title.trim(), description: description.trim() });
      if (active.current) setCreatedId(card.id);
      try { await onCreated(); }
      catch (reason) { if (active.current) setError(`Karte gespeichert, Board konnte nicht aktualisiert werden: ${errorText(reason)}`); }
    } catch (reason) { if (active.current) setError(errorText(reason)); }
    finally { if (active.current) setSaving(false); }
  }

  async function openCreated(cardId: string) {
    try { await onOpenCard(cardId); }
    catch (reason) { if (active.current) setError(errorText(reason)); }
  }

  return <form className="design-voice-task" onSubmit={(event) => void save(event)} aria-label="Design-Wunsch als Karte vorbereiten">
    <h4>Änderungswunsch für dieses Element</h4>
    <p className="design-voice-source">Gespeicherter Beleg: <code>{selection.tag} · {selection.selector}</code><br />Quelle: {selection.sourceUrl}</p>
    {createdId ? <div role="status"><p>Karte mit diesem Design-Beleg gespeichert. Kein Agent wurde gestartet.</p><button type="button" className="secondary-button" onClick={() => void openCreated(createdId)}>Karte öffnen</button></div> : <>
      <label>Titel<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Ziel und gewünschte Änderung<textarea required minLength={3} maxLength={5000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Was soll sich an diesem Element ändern?" /></label>
      {description.length > 5000 ? <p className="inline-error" role="alert">Der Entwurf ist länger als 5000 Zeichen. Kürze den Text vor dem Speichern.</p> : null}
      <div className="design-voice-actions"><button type="button" className="secondary-button" disabled={transcribing || saving} onClick={() => recording ? recorder.current?.stop() : void startRecording()}>{transcribing ? 'Transkribiere…' : recording ? 'Aufnahme beenden' : 'Wunsch aufnehmen'}</button><span role="status">{recording ? 'Aufnahme läuft · maximal 60 Sekunden' : transcribing ? 'Lokale Transkription läuft' : 'Text vor dem Speichern prüfen und bearbeiten.'}</span></div>
      <label>Board-Spalte<select value={columnId} onChange={(event) => setColumnId(event.target.value)}>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
      {queueState === 'running' ? <p className="inline-error" role="alert">Warteschlange läuft. Pausiere sie vor dem Anlegen dieser Karte.</p> : null}
      <div className="design-voice-actions"><button type="submit" className="primary-button" disabled={!candidate || !columnId || !title.trim() || description.trim().length < 3 || description.length > 5000 || recording || transcribing || saving || queueState === 'running'}>{saving ? 'Speichere…' : 'Karte mit Beleg speichern'}</button><button type="button" className="secondary-button" disabled={saving} onClick={cancel}>Verwerfen</button></div>
    </>}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </form>;
}
