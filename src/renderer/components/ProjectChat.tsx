import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Send } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import type { DraftTurn } from '../../shared/task-draft';
import type { ProjectChatReply, ProjectChatSuggestion } from '../../shared/project-chat';
import type { ProjectMemoryHit } from '../../shared/project-memory-index';
import { prepareChatCanvasNode } from '../project-chat-canvas';
import './project-chat.css';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenCard?: (cardId: string) => void;
  onOpenSession?: (sessionId: string) => void;
  onSaveTask?: (title: string, description: string) => Promise<void>;
  onSaveCanvas?: (title: string, description: string) => Promise<void>;
}

const kindName = { task: 'Aufgabe', conversation: 'Agentenlauf', commit: 'Commit', code: 'Code' } as const;

export function ProjectChat({ snapshot, onOpenCard, onOpenSession, onSaveTask, onSaveCanvas }: Props) {
  const projectId = snapshot.project.id;
  const [turns, setTurns] = useState<DraftTurn[]>([]);
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState<ProjectChatReply | null>(null);
  const [draft, setDraft] = useState<ProjectChatSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const savingCanvas = useRef(false);
  let canvasProblem = '';
  if (draft?.kind === 'canvas') {
    try { prepareChatCanvasNode(projectId, reply, draft); }
    catch (reason) { canvasProblem = reason instanceof Error ? reason.message : String(reason); }
  }

  useEffect(() => { setTurns([]); setMessage(''); setReply(null); setDraft(null); setError(''); setSaved(false); }, [projectId]);

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !message.trim()) return;
    const next = [...turns.slice(-10), { role: 'user' as const, text: message.trim() }];
    while (next.length > 1 && next.reduce((size, turn) => size + turn.text.length, 0) > 16_000) next.shift();
    setBusy(true); setError(''); setSaved(false);
    try {
      const answer = await window.studio.discussProject({ projectId, turns: next });
      setTurns([...next, { role: 'assistant', text: answer.answer }]);
      setReply(answer); setDraft(answer.suggestion); setMessage('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function saveTask() {
    if (!onSaveTask || !draft || draft.kind !== 'task' || !draft.title.trim() || !draft.body.trim() || busy) return;
    setBusy(true); setError('');
    try { await onSaveTask(draft.title.trim(), draft.body.trim()); setSaved(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function saveCanvas() {
    if (!onSaveCanvas || busy || saved || savingCanvas.current) return;
    setError('');
    let prepared;
    try { prepared = prepareChatCanvasNode(projectId, reply, draft); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    savingCanvas.current = true;
    setBusy(true);
    try { await onSaveCanvas(prepared.title, prepared.description); setSaved(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { savingCanvas.current = false; setBusy(false); }
  }

  function openSource(hit: ProjectMemoryHit) {
    if (hit.kind === 'task' && hit.cardId) onOpenCard?.(hit.cardId);
    if (hit.kind === 'conversation' && hit.sessionId) onOpenSession?.(hit.sessionId);
  }

  return <section className="project-chat" aria-label="Projektgespräch">
    <header className="project-chat-heading"><h2>Projektgespräch</h2><p>Frag nach Entscheidungen, Karten und gespeichertem Projektwissen. Aussagen bleiben an Quellen gebunden.</p></header>
    <div className="project-chat-layout">
      <div className="project-chat-main">
        <div className="project-chat-transcript" aria-live="polite">
          {turns.length ? turns.map((turn, index) => <article key={index} className={turn.role === 'user' ? 'project-chat-turn user' : 'project-chat-turn'}><small>{turn.role === 'user' ? 'Du' : 'Projektagent'}</small><p>{turn.text}</p></article>) : <p className="project-chat-empty">Zum Beispiel: „Was ist an der Review-Vorschau schon belegt, und was fehlt noch?“</p>}
        </div>
        <form className="project-chat-compose" onSubmit={(event) => void ask(event)}>
          <label htmlFor="project-chat-message">Deine Frage</label>
          <textarea id="project-chat-message" rows={3} maxLength={4_000} disabled={busy} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Frag nach einem Arbeitsstand oder besprich den nächsten Schritt …" />
          <div><small>Gespeicherte Karten, Agentenläufe, Commits und Codeauszüge · lesender Codex-Aufruf</small><button type="submit" className="primary-button" disabled={busy || !message.trim()}><Send size={15} aria-hidden="true" /> {busy ? 'Prüfe Quellen…' : 'Fragen'}</button></div>
        </form>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
      </div>
      <aside className="project-chat-evidence" aria-label="Belege und Vorschlag">
        <div className="project-chat-evidence-head"><h3>Belege</h3><small>{reply?.index.indexedAt ? `Index vom ${new Date(reply.index.indexedAt).toLocaleString('de-DE')}` : 'Noch kein Indexstand'}</small></div>
        {reply?.index.warning ? <p className="project-chat-warning">{reply.index.warning}</p> : null}
        {reply?.sources.length ? <ol>{reply.sources.map((hit) => <li key={`${hit.kind}:${hit.sourceId}`}><span>{kindName[hit.kind]} · {new Date(hit.updatedAt).toLocaleDateString('de-DE')}{hit.gitRef ? ` · ${hit.gitRef.slice(0, 8)}` : ''}</span><code className="project-chat-source-id">{hit.kind}:{hit.sourceId}</code><strong>{hit.title}</strong><p>{hit.snippet}</p>{(hit.kind === 'task' && onOpenCard || hit.kind === 'conversation' && onOpenSession) ? <button type="button" className="text-button" onClick={() => openSource(hit)}>Quelle öffnen <ArrowUpRight size={14} aria-hidden="true" /></button> : null}</li>)}</ol> : <p className="project-chat-muted">Nach einer Antwort stehen hier die tatsächlich verwendeten lokalen Quellen.</p>}
        {draft ? <div className="project-chat-draft">
          <h3>{draft.kind === 'task' ? 'Kartenvorschlag' : 'Canvas-Skizze'}</h3>
          <p>Entwurf – noch nicht übernommen.</p>
          <label>Titel<input value={draft.title} disabled={busy} maxLength={draft.kind === 'canvas' ? 120 : 160}
            onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setSaved(false); }} /></label>
          <label>Beschreibung<textarea rows={5} maxLength={8_000} disabled={busy} value={draft.body}
            onChange={(event) => { setDraft({ ...draft, body: event.target.value }); setSaved(false); }} /></label>
          <label>Schritte<textarea rows={4} disabled={busy} value={draft.steps.join('\n')}
            onChange={(event) => { setDraft({ ...draft, steps: event.target.value.split('\n').slice(0, 8) }); setSaved(false); }} /></label>
          {draft.kind === 'task' && onSaveTask ? <button type="button" className="secondary-button" disabled={busy || saved || !draft.title.trim() || !draft.body.trim()} onClick={() => void saveTask()}>{saved ? 'Karte erstellt' : 'Karte bewusst erstellen'}</button> : null}
          {draft.kind === 'canvas' && onSaveCanvas ? <>
            <p className="project-chat-canvas-note">Eine Box im Whiteboard speichern. Angezeigte Gesprächsbelege und deren Indexzeit werden als Text übernommen; sie bestätigen Änderungen am Entwurf nicht automatisch.</p>
            {canvasProblem ? <p className="project-chat-canvas-problem" role="status">{canvasProblem}</p> : null}
            <button type="button" className="secondary-button" disabled={busy || saved || Boolean(canvasProblem)} onClick={() => void saveCanvas()}>{saved ? 'Im Whiteboard gespeichert' : 'Im Whiteboard speichern'}</button>
          </> : null}
        </div> : null}
      </aside>
    </div>
  </section>;
}
