import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

type PendingUpdate = { mutationId: string; update: string };
type PresentMember = { memberId: string; displayName: string };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

/** Collaborative text is still a proposal; this editor never changes the accepted card. */
export function TeamCardDraftEditor({ workspaceId, projectId, cardId, cardTitle, canEdit, onCardChanged }: {
  workspaceId: string; projectId: string; cardId: string; cardTitle: string; canEdit: boolean;
  onCardChanged?: () => void;
}) {
  const documentRef = useRef<Y.Doc | null>(null);
  const retrySyncRef = useRef<() => void>(() => undefined);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('Lade Entwurf…');
  const [members, setMembers] = useState<PresentMember[]>([]);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'interrupted'>('connecting');
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    setReady(false);
    setError('');
    setStatus('Lade Entwurf…');
    setMembers([]);
    setStreamStatus('connecting');
    let active = true;
    let sending = false;
    let polling = false;
    let recovering = false;
    let loaded = false;
    const pending: PendingUpdate[] = [];
    const ydoc = new Y.Doc();
    const watchId = crypto.randomUUID();
    documentRef.current = ydoc;
    const source = { workspaceId, projectId, cardId };
    const applyRemote = (update: string) => {
      if (update) Y.applyUpdate(ydoc, Uint8Array.from(atob(update), (character) => character.charCodeAt(0)), 'remote');
      if (active) setText(ydoc.getText('body').toString());
    };
    const flush = async () => {
      if (!active || sending || !pending.length) return;
      sending = true;
      while (active && pending.length) {
        const next = pending[0]!;
        try {
          setStatus('Synchronisiere…');
          const saved = await window.studio.updateTeamCardDraft({ ...source, ...next });
          if (!active) return;
          pending.shift();
          applyRemote(saved.update);
          setRevision(saved.revision); setError('');
        } catch (reason) {
          if (active) { setStatus('Nicht synchronisiert'); setError(messageOf(reason)); }
          break;
        }
      }
      sending = false;
      if (active && !pending.length) setStatus('Synchronisiert');
    };
    retrySyncRef.current = () => {
      if (!active || recovering) return;
      recovering = true;
      setStatus('Synchronisiere…');
      void window.studio.resumeTeamCardDraftUpdates(source)
        .then(() => window.studio.teamCardDraft(source))
        .then(async (draft) => {
          if (!active) return;
          applyRemote(draft.update);
          setRevision((value) => Math.max(value, draft.revision));
          setError('');
          await flush();
          if (active && !pending.length) setStatus('Synchronisiert');
        })
        .catch((reason: unknown) => { if (active) { setStatus('Nicht synchronisiert'); setError(messageOf(reason)); } })
        .finally(() => { recovering = false; });
    };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      let binary = '';
      for (const byte of update) binary += String.fromCharCode(byte);
      pending.push({ mutationId: crypto.randomUUID(), update: btoa(binary) });
      setStatus('Synchronisiere…');
      void flush();
    };
    ydoc.on('update', onUpdate);
    void (async () => {
      const pendingOnDisk = await window.studio.pendingTeamCardDraftUpdates(source);
      const draft = await window.studio.teamCardDraft(source);
      if (!active) return;
      applyRemote(draft.update);
      for (const item of pendingOnDisk) applyRemote(item.update);
      setRevision((current) => Math.max(current, draft.revision)); loaded = true; setReady(true);
      setStatus(pendingOnDisk.length ? 'Wiederhole ausstehende Änderungen…' : 'Synchronisiert');
      if (pendingOnDisk.length) {
        await window.studio.resumeTeamCardDraftUpdates(source);
        if (!active) return;
        const current = await window.studio.teamCardDraft(source);
        applyRemote(current.update); setRevision((value) => Math.max(value, current.revision)); setStatus('Synchronisiert');
      }
    })().catch((reason: unknown) => { if (active) { setStatus('Nicht verbunden'); setError(messageOf(reason)); } });
    const timer = setInterval(() => {
      if (!active || !loaded || polling) return;
      polling = true;
      void window.studio.resumeTeamCardDraftUpdates(source).then(() => window.studio.teamCardDraft(source)).then((draft) => {
        if (!active) return;
        applyRemote(draft.update); setRevision((value) => Math.max(value, draft.revision));
        if (pending.length) void flush();
        else { setStatus('Synchronisiert'); setError(''); }
      }).catch((reason: unknown) => { if (active) { setStatus('Nicht verbunden'); setError(messageOf(reason)); } })
        .finally(() => { polling = false; });
    }, 5_000);
    const unsubscribe = window.studio.onTeamDraftEvent((event) => {
      if (!active || event.watchId !== watchId) return;
      if ('event' in event) {
        if (event.event.type === 'presence') setMembers(event.event.members);
        if (event.event.type === 'card') onCardChanged?.();
        if (event.event.type === 'draft' && loaded) {
          void window.studio.teamCardDraft(source).then((draft) => {
            if (!active) return;
            applyRemote(draft.update); setRevision((value) => Math.max(value, draft.revision));
          }).catch((reason: unknown) => { if (active) { setStatus('Nicht synchronisiert'); setError(messageOf(reason)); } });
        }
      } else if (event.type === 'connected') {
        setStreamStatus('live');
        if (loaded) void flush();
      } else {
        setMembers([]); setStreamStatus('interrupted');
      }
    });
    void window.studio.startTeamDraftWatch({ watchId, ...source })
      .catch(() => { if (active) setStreamStatus('interrupted'); });
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
      void window.studio.stopTeamDraftWatch(watchId);
      ydoc.off('update', onUpdate);
      ydoc.destroy();
      documentRef.current = null;
      retrySyncRef.current = () => undefined;
    };
  }, [workspaceId, projectId, cardId, retryToken]);

  const edit = (value: string) => {
    const document = documentRef.current;
    if (!document || !ready || !canEdit) return;
    const shared = document.getText('body');
    const previous = shared.toString();
    let prefix = 0;
    while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < value.length - prefix &&
      previous[previous.length - 1 - suffix] === value[value.length - 1 - suffix]) suffix++;
    document.transact(() => {
      shared.delete(prefix, previous.length - prefix - suffix);
      shared.insert(prefix, value.slice(prefix, value.length - suffix));
    });
    setText(value);
  };

  return <section className="team-card-draft" aria-label={`Gemeinsamer Entwurf für ${cardTitle}`}>
    <div className="team-card-draft-heading"><div><h3>{cardTitle}</h3><p>Gemeinsamer Entwurf · noch nicht als Kartenbeschreibung übernommen</p></div>
      <span className="team-card-save-state" data-state={error ? 'error' : status === 'Synchronisiert' ? 'saved' : 'pending'} role="status">{status}{revision ? ` · Stand ${revision}` : ''}</span></div>
    <div className="team-card-presence" aria-live="polite">
      <span className="team-card-presence-state" data-state={streamStatus}>
        {streamStatus === 'live' ? 'Live verbunden' : streamStatus === 'connecting' ? 'Live-Verbindung wird aufgebaut…' : 'Live-Verbindung unterbrochen'}</span>
      {streamStatus === 'live' && members.length ? <span>Geöffnet von: {members.map((member) => member.displayName).join(', ')}</span> : null}
      {streamStatus === 'interrupted' ? <span>Der regelmäßige Abgleich versucht weiter zu verbinden.</span> : null}
    </div>
    <textarea value={text} onChange={(event) => edit(event.currentTarget.value)} disabled={!ready} readOnly={!canEdit} maxLength={20_000}
      aria-label={canEdit ? 'Gemeinsamen Kartenentwurf bearbeiten' : 'Gemeinsamen Kartenentwurf lesen'}
      placeholder="Was soll das Team an dieser Karte planen?" />
    {!canEdit ? <p className="team-workspace-muted">Für dieses Projekt ist dein Zugang auf Lesen begrenzt.</p> : null}
    {error ? <div className="team-card-sync-error inline-error" role="alert"><p>{error}</p><p>Eingaben ohne Host-Bestätigung bleiben hier sichtbar. Geschütztes lokales Speichern kann bei diesem Fehler nicht vorausgesetzt werden.</p>
      <button type="button" className="text-button" onClick={() => ready ? retrySyncRef.current() : setRetryToken((value) => value + 1)}>
        {ready ? 'Jetzt synchronisieren' : 'Erneut verbinden'}</button></div> : null}
  </section>;
}
