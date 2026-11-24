import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Bot, CircleStop, Mic, MicOff, Play, Plus, RotateCcw, Send, Terminal, X } from 'lucide-react';
import type { Card, CardPriority, ProjectSnapshot, WorktreeReview } from '../../shared/types';
import type { WorktreeCleanupPreview } from '../../shared/worktree-cleanup';
import type { ConflictRadarResult } from '../../shared/conflict-radar';
import { CARD_PRIORITIES } from '../../shared/card-metadata';
import type { Mutate } from './shared';
import { CardAttachments } from './CardAttachments';
import { CardContextPanel } from './CardContextPanel';
import { CardAcceptancePanel } from './CardAcceptancePanel';
import { CardRequirementStatus } from './CardRequirementStatus';
import { CardSplitPanel } from './CardSplitPanel';
import { SessionEvidencePanel } from './SessionEvidencePanel';
import { SessionRecoveryPanel } from './SessionRecoveryPanel';
import { AgentHandoffPanel } from './AgentHandoffPanel';
import { ParallelRunPanel } from './ParallelRunPanel';
import type { CardRunGate } from '../../shared/parallel-runs';
import type { CardCriterionEvidenceKind } from '../../shared/card-acceptance';
import { CardQaPanel } from './CardQaPanel';
import { PrDraftPanel } from './PrDraftPanel';
import { OutputErrorPanel } from './OutputErrorPanel';
import { ConflictRadarNotice } from './ConflictRadarNotice';
import { IntegrationQueuePanel } from './IntegrationQueuePanel';
import { CardDevEnvironmentPanel } from './CardDevEnvironmentPanel';
import { ManualRevisionPanel } from './ManualRevisionPanel';
import { startConflictRadarRefresh } from '../conflict-radar-schedule';
import { parallelStartWarning } from '../parallel-run-gate';
import { addCardLabel, labelSuggestions } from '../card-labels';
import '../card-label-editor.css';

const SessionTerminal = lazy(() => import('./SessionTerminal').then((module) => ({ default: module.SessionTerminal })));
const ReviewDiffPanel = lazy(() => import('./ReviewDiffPanel').then((module) => ({ default: module.ReviewDiffPanel })));

interface Props { card: Card; snapshot: ProjectSnapshot; mutate: Mutate; onClose: () => void; onOpenCard: (id: string) => void; onOpenDesign?: (cardId: string) => void; onOpenBrowser?: () => void; focusSession?: boolean; focusReviewComment?: { id: string; token: number } | null; focusQaReport?: { id: string; token: number } | null }

export function CardPanel({ card, snapshot, mutate, onClose, onOpenCard, onOpenDesign, onOpenBrowser, focusSession, focusReviewComment, focusQaReport }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [priority, setPriority] = useState<CardPriority>(card.priority);
  const [labels, setLabels] = useState(card.labels);
  const [labelDraft, setLabelDraft] = useState('');
  const [metadataError, setMetadataError] = useState('');
  const [agentId, setAgentId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [runGate, setRunGate] = useState<CardRunGate | null>(null);
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [contextAttachmentRequest, setContextAttachmentRequest] = useState<{ cardId: string; attachmentId: string; token: number } | null>(null);
  const [worktreeReview, setWorktreeReview] = useState<WorktreeReview | null | undefined>(undefined);
  const [cleanupPreview, setCleanupPreview] = useState<WorktreeCleanupPreview | null | undefined>(undefined);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeError, setWorktreeError] = useState('');
  const cleanupRequest = useRef(0);
  const [showDiffReview, setShowDiffReview] = useState(false);
  const [criterionQaFocus, setCriterionQaFocus] = useState<{ id: string; token: number } | null>(null);
  const [criterionReviewFocus, setCriterionReviewFocus] = useState<{ id: string; token: number } | null>(null);
  const [conflictRadar, setConflictRadar] = useState<ConflictRadarResult | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState('');
  const conflictRequest = useRef(0);
  const conflictInFlight = useRef(false);
  const conflictSessionKey = useRef('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const sessionHeadingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { cleanupRequest.current += 1; setTitle(card.title); setDescription(card.description); setPriority(card.priority); setLabels(card.labels); setLabelDraft(''); setMetadataError(''); setPrompt(''); setMessage(''); setUseWorktree(false); setWorktreeReview(undefined); setCleanupPreview(undefined); setWorktreeBusy(false); setWorktreeError(''); setShowDiffReview(false); setCriterionQaFocus(null); setCriterionReviewFocus(null); setConflictRadar(null); setConflictError(''); }, [card.id]);
  useEffect(() => {
    if (focusSession && sessionHeadingRef.current) {
      sessionHeadingRef.current.scrollIntoView({ block: 'start' });
      sessionHeadingRef.current.focus();
    } else closeButtonRef.current?.focus();
  }, [card.id, focusSession]);
  useEffect(() => { if (focusReviewComment) setShowDiffReview(true); }, [card.id, focusReviewComment?.id, focusReviewComment?.token]);
  useEffect(() => { setCriterionReviewFocus(null); }, [focusReviewComment?.token]);
  useEffect(() => { setCriterionQaFocus(null); }, [focusQaReport?.token]);
  useEffect(() => () => { recorderRef.current?.stop(); streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);
  useEffect(() => () => { conflictRequest.current += 1; conflictInFlight.current = false; }, []);

  const sessions = useMemo(() => snapshot.sessions.filter((item) => item.cardId === card.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)), [snapshot.sessions, card.id]);
  const session = sessions.find((item) => item.state === 'running') ?? sessions[0] ?? null;
  useEffect(() => {
    // A drawer can stay open across periodic snapshots. Check at most once per
    // 30 seconds, while its current agent is running, without blocking renders.
    const key = `${card.id}:${session?.id ?? ''}:${session?.state ?? ''}`;
    if (conflictSessionKey.current !== key) {
      conflictSessionKey.current = key;
      conflictRequest.current += 1;
      conflictInFlight.current = false;
      setConflictRadar(null);
      setConflictError('');
      setConflictBusy(false);
    }
    const stop = startConflictRadarRefresh(session?.state === 'running', () => { void reviewConflicts(); });
    return stop;
  }, [card.id, session?.id, session?.state]);
  const sessionAgent = session ? snapshot.agents.find((item) => item.id === session.agentId) : null;
  const enabledAgents = snapshot.agents.filter((item) => item.enabled);
  const defaultAgentId = snapshot.columns.find((column) => column.id === card.columnId)?.agentId ?? enabledAgents[0]?.id ?? '';
  const chosenAgentId = agentId || defaultAgentId;
  const acceptRunGate = useCallback((next: CardRunGate | null) => setRunGate(next), []);
  const parallelWarning = parallelStartWarning(runGate, useWorktree);
  const startBlocked = !runGate || runGate.cardId !== card.id || !runGate.canStart || Boolean(parallelWarning);


  async function saveCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (card.archivedAt) return;
    let nextLabels = labels;
    try { if (labelDraft.trim()) nextLabels = addCardLabel(labels, labelDraft); }
    catch (reason) { setMetadataError(reason instanceof Error ? reason.message : String(reason)); return; }
    const saved = await mutate(() => window.studio.updateCard({ id: card.id, title: title.trim(), description, priority, labels: nextLabels }));
    if (saved) { setLabels(nextLabels); setLabelDraft(''); setMetadataError(''); }
  }

  function addLabel() {
    try { setLabels(addCardLabel(labels, labelDraft)); setLabelDraft(''); setMetadataError(''); }
    catch (reason) { setMetadataError(reason instanceof Error ? reason.message : String(reason)); }
  }

  function openAcceptanceEvidence(kind: CardCriterionEvidenceKind, sourceId: string) {
    if (kind === 'qa') setCriterionQaFocus((old) => ({ id: sourceId, token: (old?.token ?? 0) + 1 }));
    else { setShowDiffReview(true); setCriterionReviewFocus((old) => ({ id: sourceId, token: (old?.token ?? 0) + 1 })); }
  }

  async function reviewWorktree() {
    const request = ++cleanupRequest.current;
    setWorktreeBusy(true); setWorktreeError(''); setCleanupPreview(undefined);
    try {
      const review = await window.studio.reviewCardWorktree(card.id);
      if (request !== cleanupRequest.current) return;
      setWorktreeReview(review);
      if (review) await reviewConflicts();
      else setConflictRadar(null);
    }
    catch (reason) { if (request === cleanupRequest.current) setWorktreeError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (request === cleanupRequest.current) setWorktreeBusy(false); }
  }

  async function checkCleanup() {
    const request = ++cleanupRequest.current;
    setWorktreeBusy(true); setWorktreeError(''); setCleanupPreview(undefined);
    try {
      const preview = await window.studio.previewCardWorktreeCleanup(card.id);
      if (request === cleanupRequest.current) setCleanupPreview(preview);
    }
    catch (reason) { if (request === cleanupRequest.current) setWorktreeError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (request === cleanupRequest.current) setWorktreeBusy(false); }
  }

  async function reviewConflicts() {
    if (conflictInFlight.current) return;
    conflictInFlight.current = true;
    const request = ++conflictRequest.current;
    setConflictBusy(true); setConflictError('');
    try {
      const result = await window.studio.reviewCardConflicts(card.id);
      if (request === conflictRequest.current) setConflictRadar(result);
    } catch (reason) {
      if (request === conflictRequest.current) {
        setConflictRadar(null);
        setConflictError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (request === conflictRequest.current) {
        conflictInFlight.current = false;
        setConflictBusy(false);
      }
    }
  }

  async function changeArchive(archived: boolean) {
    if (archived && !window.confirm(`„${card.title}“ archivieren? Die Karte bleibt erhalten und kann wiederhergestellt werden.`)) return;
    setArchiveBusy(true); setArchiveError('');
    const changed = await mutate(async () => {
      try { return await window.studio.setCardArchived({ id: card.id, archived }); }
      catch (reason) { setArchiveError(reason instanceof Error ? reason.message : String(reason)); throw reason; }
    });
    setArchiveBusy(false);
    if (changed) onClose();
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !message.trim()) return;
    const sent = await mutate(() => window.studio.sendSession({ sessionId: session.id, text: message.trim() }));
    if (sent !== null) setMessage('');
  }

  async function startRecording() {
    setVoiceError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Dieses System unterstützt die Mikrofonaufnahme nicht.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => setVoiceError('Die Aufnahme ist fehlgeschlagen.');
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        if (chunks.length === 0) { setVoiceError('Die Aufnahme ist leer.'); return; }
        setTranscribing(true);
        try {
          const audio = new Uint8Array(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
          const text = await window.studio.transcribe(audio);
          setPrompt((old) => [old.trim(), text.trim()].filter(Boolean).join(' '));
        } catch (reason) {
          setVoiceError(reason instanceof Error ? reason.message : String(reason));
        } finally { setTranscribing(false); }
      };
      recorder.start(250);
      setRecording(true);
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setVoiceError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside ref={drawerRef} className="card-drawer" role="dialog" aria-modal="true" aria-labelledby={`card-dialog-title-${card.id}`} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])') ?? [])].filter((item) => item.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}><header className="drawer-header"><div><small>KARTE · {snapshot.columns.find((column) => column.id === card.columnId)?.name}{card.archivedAt ? ' · ARCHIVIERT' : ''}</small><h2 id={`card-dialog-title-${card.id}`}>{card.title}</h2></div><button ref={closeButtonRef} className="icon-button" type="button" aria-label="Karte schließen" onClick={onClose}><X size={19} /></button></header>
      <div className="drawer-content">
        <form className="stacked-form" onSubmit={(event) => void saveCard(event)}><fieldset className="archive-fieldset" disabled={Boolean(card.archivedAt)}>
          <label>Titel<input value={title} required maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Beschreibung<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ziel, Kontext und gewünschtes Ergebnis…" /></label>
          <div className="card-metadata-fields">
            <label>Priorität<select value={priority} onChange={(event) => setPriority(event.target.value as CardPriority)}>{CARD_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <div className="card-label-editor"><label htmlFor={`card-label-input-${card.id}`}>Labels</label><div className="card-label-editor-list">{labels.map((label) => <span className="card-label-editor-chip" key={label}>{label}<button type="button" aria-label={`Label ${label} entfernen`} onClick={() => setLabels((current) => current.filter((item) => item !== label))}><X size={12} aria-hidden="true" /></button></span>)}</div><div className="card-label-editor-add"><input id={`card-label-input-${card.id}`} aria-label="Neues Label" list={`card-label-suggestions-${card.id}`} value={labelDraft} maxLength={32} onChange={(event) => { setLabelDraft(event.target.value); setMetadataError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addLabel(); } }} placeholder="Label anlegen oder auswählen" /><button className="secondary-button small" type="button" disabled={!labelDraft.trim() || labels.length >= 12 && !labels.some((item) => item.toLocaleLowerCase('de-DE') === labelDraft.trim().toLocaleLowerCase('de-DE'))} onClick={addLabel}><Plus size={14} /> Hinzufügen</button></div><datalist id={`card-label-suggestions-${card.id}`}>{labelSuggestions(snapshot.cards, labels).map((label) => <option key={label} value={label} />)}</datalist><small>Bis zu 12 Labels pro Karte. Vorhandene Labels im Projekt werden vorgeschlagen.</small>{metadataError ? <small role="alert" className="card-label-error">{metadataError}</small> : null}</div>
          </div>
          <div className="form-row"><label>Spalte<select value={card.columnId} onChange={(event) => void mutate(() => window.studio.moveCard({ id: card.id, columnId: event.target.value }))}>{[...snapshot.columns].sort((a, b) => a.position - b.position).map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><button className="secondary-button" type="submit">Karte speichern</button></div>
        </fieldset></form>
        <div className="archive-controls">{card.archivedAt ? <><p>Archiviert am {new Date(card.archivedAt).toLocaleString('de-DE')}. Verlauf und Daten bleiben erhalten.</p><button className="secondary-button" type="button" disabled={archiveBusy} onClick={() => void changeArchive(false)}><RotateCcw size={15} /> Wiederherstellen</button></> : <button className="text-button archive-action" type="button" disabled={archiveBusy} onClick={() => void changeArchive(true)}><Archive size={15} /> Karte archivieren</button>}</div>
        {archiveError ? <p className="inline-error" role="alert">{archiveError}</p> : null}
        <label className="field-label"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={card.wireframeRequired} disabled={Boolean(card.archivedAt) || session?.state === 'running'} onChange={(event) => void mutate(() => window.studio.updateCard({ id: card.id, wireframeRequired: event.target.checked }))} /> Wireframe vor Agentenstart prüfen</span></label>
        <p className="field-help">Wenn aktiviert, starten Karten-Agenten und Workflow-Schritte erst mit einem gespeicherten, aktuell freigegebenen Entwurf. Die Freigabe startet keinen Agenten.</p>
        {onOpenDesign ? <button type="button" className="secondary-button" onClick={() => { onClose(); onOpenDesign(card.id); }}>Wireframe in Design öffnen</button> : null}
        <div className="drawer-divider" />
        <CardAttachments key={`attachments-${card.id}`} card={card} onPrepareContext={(attachmentId) => setContextAttachmentRequest((previous) => ({ cardId: card.id, attachmentId, token: (previous?.token ?? 0) + 1 }))} />
        <div className="drawer-divider" />
        <CardContextPanel key={`context-${card.id}`} card={card} attachmentRequest={contextAttachmentRequest?.cardId === card.id ? contextAttachmentRequest : null} />
        <div className="drawer-divider" />
        <CardAcceptancePanel key={`acceptance-${card.id}`} card={card} onOpenEvidence={openAcceptanceEvidence} />
        <CardRequirementStatus projectId={card.projectId} cardId={card.id} onOpenCard={onOpenCard} />
        <div className="drawer-divider" />
        <CardSplitPanel key={`split-${card.id}`} card={card} columns={snapshot.columns} queue={snapshot.queue} mutate={mutate} onOpenCard={onOpenCard} />
        <div className="drawer-divider" />
        <div className="section-heading"><Bot size={19} /><h3>Agent</h3></div>
        <p className="section-copy">{card.archivedAt ? 'Diese Karte ist archiviert. Stelle sie wieder her, bevor ein Agent weiterarbeitet.' : 'Starte einen CLI-Agenten im Projektordner. Seine Dateizugriffe folgen den Rechten deines Benutzerkontos.'}</p>
        <label className="field-label">Agent auswählen<select value={chosenAgentId} disabled={Boolean(card.archivedAt)} onChange={(event) => setAgentId(event.target.value)}><option value="">Agent wählen</option>{enabledAgents.map((item) => <option key={item.id} value={item.id}>{item.name}{item.model ? ` · ${item.model}` : ''}</option>)}</select></label>
        <label className="field-label">Auftrag<textarea rows={4} value={prompt} disabled={Boolean(card.archivedAt)} onChange={(event) => setPrompt(event.target.value)} placeholder="Was soll der Agent an dieser Karte tun?" /></label>
        <label className="field-label"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={useWorktree} disabled={Boolean(card.archivedAt)} onChange={(event) => setUseWorktree(event.target.checked)} /> Isolierten Git-Worktree für diese Sitzung verwenden</span></label>
        <ParallelRunPanel key={card.id} card={card} cards={snapshot.cards} mutate={mutate} onGate={acceptRunGate} />
        {parallelWarning ? <p className="inline-note">{parallelWarning}</p> : null}
        <div className="agent-actions"><button className="primary-button" type="button" disabled={Boolean(card.archivedAt) || !chosenAgentId || session?.state === 'running' || startBlocked} onClick={() => void mutate(() => window.studio.startSession({ cardId: card.id, agentId: chosenAgentId, prompt: prompt.trim() || undefined, useWorktree }))}><Play size={16} /> Agent starten</button><button type="button" className={recording ? 'voice-button recording' : 'voice-button'} disabled={Boolean(card.archivedAt) || transcribing} onClick={() => recording ? recorderRef.current?.stop() : void startRecording()} title={recording ? 'Aufnahme beenden' : 'Spracheingabe'}>{recording ? <MicOff size={17} /> : <Mic size={17} />}{transcribing ? 'Transkribiere…' : recording ? 'Aufnahme beenden' : 'Sprechen'}</button></div>
        <AgentHandoffPanel key={`handoff-${card.id}`} card={card} sourceSession={session} targetAgentId={chosenAgentId} useWorktree={useWorktree} queueRunning={snapshot.queue?.state === 'running'} mutate={mutate} />
        {voiceError ? <p className="inline-error" role="alert">{voiceError}</p> : null}
        {enabledAgents.length === 0 ? <p className="inline-note">Noch kein Agent eingerichtet. Unter „Agenten“ kannst du installierte CLIs erkennen und einen Startbefehl speichern.</p> : null}
        <div className="drawer-divider" />
        <div ref={sessionHeadingRef} className="section-heading" tabIndex={-1}><Terminal size={19} /><h3>Terminal</h3><span className={session?.state === 'running' ? 'session-state running' : 'session-state'}>{session?.state === 'running' ? 'Läuft' : session?.state === 'failed' ? 'Fehlgeschlagen' : session?.state === 'exited' ? 'Beendet' : session?.state === 'stopped' ? 'Gestoppt' : 'Kein Lauf'}</span></div>
        {session ? <>
          <Suspense fallback={<div className="terminal-empty">Terminal wird geladen…</div>}><SessionTerminal key={session.id} session={session} /></Suspense>
          <SessionRecoveryPanel key={`recovery-${session.id}`} session={session} />
          {session.state === 'running' ? <div className="terminal-controls"><form onSubmit={(event) => void send(event)}><input aria-label="Nachricht an Agent" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Nachricht an Agent senden…" /><button type="submit" className="icon-button" disabled={!message.trim()} aria-label="Senden"><Send size={17} /></button></form><button type="button" className="danger-button" onClick={() => void mutate(() => window.studio.stopSession(session.id))}><CircleStop size={15} /> Stoppen</button></div> : null}
          {sessionAgent?.kind === 'codex' && session.state !== 'running' && !card.archivedAt ? <div className="resume-controls">
            {session.codexThreadId ? <p className="section-copy">Codex hat dieses Gespräch als <code>{session.codexThreadId}</code> gemeldet. Prüfe vorher den Kartenverlauf und mögliche Dateiänderungen. Der alte Auftrag wird nicht erneut gesendet.</p>
              : <p className="section-copy">Für diesen Lauf wurde keine Codex-Gesprächs-ID zuverlässig erfasst. Wähle das passende Gespräch im Codex-Terminal selbst aus; der alte Auftrag wird nicht erneut gesendet.</p>}
            <div className="agent-actions">
              {session.codexThreadId ? <button className="primary-button" type="button" disabled={snapshot.queue.state === 'running'} onClick={() => void mutate(() => window.studio.resumeCodexSession({ sessionId: session.id }))}><RotateCcw size={15} /> Dieses Gespräch fortsetzen</button> : null}
              <button className="secondary-button" type="button" disabled={snapshot.queue.state === 'running'} onClick={() => void mutate(() => window.studio.resumeCodexSession({ sessionId: session.id, picker: true }))}><RotateCcw size={15} /> {session.codexThreadId ? 'Anderes Gespräch auswählen' : 'Codex-Gespräch auswählen'}</button>
            </div>
            {snapshot.queue.state === 'running' ? <p className="inline-note">Projektwarteschlange zuerst pausieren.</p> : null}
          </div> : null}
          {session.worktreePath ? <p className="run-meta">Git-Worktree: <code>{session.worktreePath}</code>. Änderungen bleiben dort nach dem Stoppen erhalten.</p> : null}<p className="run-meta">Gestartet {new Date(session.startedAt).toLocaleString('de-DE')} · {sessions.length} Lauf{sessions.length === 1 ? '' : 'e'}</p>
          <SessionEvidencePanel key={`run-evidence-${card.id}`} sessions={sessions} archived={Boolean(card.archivedAt)} onOpenQa={(reportId) => setCriterionQaFocus((old) => ({ id: reportId, token: (old?.token ?? 0) + 1 }))} />
          {session.state !== 'running' ? <OutputErrorPanel key={session.id} projectId={card.projectId} sourceKind="session" sourceId={session.id} columns={snapshot.columns} onCreated={async (created) => { await mutate(async () => created); onOpenCard(created.id); }} /> : null}
        </> : <div className="terminal-empty">Noch kein Agentenlauf für diese Karte.</div>}
        <div className="drawer-divider" />
        <CardDevEnvironmentPanel key={`dev-env-${card.id}`} cardId={card.id} projectId={card.projectId} archived={Boolean(card.archivedAt)} onOpenBrowser={() => { onClose(); onOpenBrowser?.(); }} />
        <div className="drawer-divider" />
        <CardQaPanel key={`qa-${card.id}`} card={card} focusReport={criterionQaFocus ?? focusQaReport} />
        <div className="drawer-divider" />
        <div className="section-heading"><h3>Git-Worktree prüfen</h3></div>
        <p className="section-copy">Status und Änderungsumfang lokal prüfen. Die App übernimmt nur committete Änderungen per Fast-Forward; bei divergierten Branches bleibt alles unangetastet.</p>
        <div className="agent-actions"><button className="secondary-button" type="button" disabled={worktreeBusy} onClick={() => void reviewWorktree()}>{worktreeBusy ? 'Prüfe…' : 'Git-Stand prüfen'}</button><button className="secondary-button" type="button" aria-expanded={showDiffReview} onClick={() => setShowDiffReview((open) => !open)}>{showDiffReview ? 'Diff schließen' : 'Diff und Kommentare'}</button><button className="secondary-button" type="button" disabled={conflictBusy || worktreeBusy} onClick={() => void reviewConflicts()}>{conflictBusy ? 'Prüfe…' : 'Karten-Worktrees vergleichen'}</button></div>
        {session?.state === 'running' ? <p className="run-meta">Bei geöffneter Karte wird das Konflikt-Radar etwa alle 30 Sekunden automatisch aktualisiert.</p> : null}
        {worktreeError ? <p className="inline-error" role="alert">{worktreeError}</p> : null}
        {conflictError ? <p className="inline-error" role="alert">Konflikt-Radar: {conflictError}</p> : null}
        {conflictRadar ? <ConflictRadarNotice result={conflictRadar} /> : null}
        {worktreeReview === null ? <p className="inline-note">Für diese Karte gibt es noch keinen Git-Worktree.</p> : null}
        {worktreeReview ? <div className="stacked-form"><p className="section-copy"><strong>{worktreeReview.branch}</strong><br />Worktree: <code>{worktreeReview.path}</code><br />Ziel: <code>{worktreeReview.targetPath}</code> ({worktreeReview.targetBranch ?? 'detached'})<br />Commits: {worktreeReview.ahead} voraus, {worktreeReview.behind} zurück.</p>
          {worktreeReview.sourceStatus.length ? <><strong>Nicht committiert im Worktree</strong><pre className="terminal-output">{worktreeReview.sourceStatus.join('\n')}</pre></> : <p className="section-copy">Worktree-Arbeitsbaum sauber.</p>}
          {worktreeReview.targetStatus.length ? <><strong>Nicht committiert im Ziel</strong><pre className="terminal-output">{worktreeReview.targetStatus.join('\n')}</pre></> : null}
          {worktreeReview.uncommittedStat ? <><strong>Uncommitteter Diff-Stat</strong><pre className="terminal-output">{worktreeReview.uncommittedStat}</pre></> : null}
          {worktreeReview.committedStat ? <><strong>Committeter Diff-Stat</strong><pre className="terminal-output">{worktreeReview.committedStat}</pre></> : null}
          {worktreeReview.blockers.length ? <p className="inline-note">Merge gesperrt: {worktreeReview.blockers.join(' ')}</p> : null}
          <button className="text-button" type="button" disabled={worktreeBusy} onClick={() => void checkCleanup()}>Aufräumbarkeit prüfen</button>
        </div> : null}
        <ManualRevisionPanel key={`manual-${card.id}`} cardId={card.id} />
        <IntegrationQueuePanel card={card} cards={snapshot.cards} onIntegrated={() => void reviewWorktree()} onOpenDiff={() => {
          setShowDiffReview(true);
          let attempts = 0;
          const scrollToDiff = () => {
            const panel = document.querySelector('.review-diff');
            if (panel) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
            else if (attempts++ < 20) window.setTimeout(scrollToDiff, 50);
          };
          window.setTimeout(scrollToDiff, 0);
        }} />
        {cleanupPreview === null ? <p className="inline-note">Für diese Karte gibt es keinen gespeicherten Worktree.</p> : null}
        {cleanupPreview ? <section className="stacked-form" aria-label="Lesende Worktree-Aufräumprüfung">
          <h4>Worktree-Aufräumprüfung</h4>
          <p className="section-copy">Geprüft {new Date(cleanupPreview.checkedAt).toLocaleString('de-DE')}. Dieser Stand ist eine Momentaufnahme; Branchloom entfernt hier weder Dateien noch Git-Branches.</p>
          <p className="run-meta">Repository: <code>{cleanupPreview.targetPath}</code><br />Worktree: <code>{cleanupPreview.path}</code><br />Branch: <code>{cleanupPreview.branch}</code> → <code>{cleanupPreview.targetBranch ?? 'detached'}</code><br />Worktree-HEAD: <code>{cleanupPreview.sourceHead}</code><br />Ziel-HEAD: <code>{cleanupPreview.targetHead}</code></p>
          <p className="section-copy">Arbeitsbaum: {cleanupPreview.sourceClean ? 'sauber' : 'Änderungen vorhanden'} · Ignorierte Dateien: {cleanupPreview.ignoredFilesPresent ? 'vorhanden' : 'keine gefunden'} · Ziel: {cleanupPreview.targetClean ? 'sauber' : 'Änderungen vorhanden'} · Commit im Ziel: {cleanupPreview.mergedIntoTarget ? 'belegt' : 'nicht belegt'} · Laufender Agent: {cleanupPreview.activeSession ? 'ja' : 'nein'}</p>
          {cleanupPreview.blockers.length ? <p className="inline-note">Offene Punkte: {cleanupPreview.blockers.join(' ')}</p> : <p className="inline-note">Für diesen Zeitpunkt wurden keine der geprüften Blocker gefunden. Die Entfernung ist in dieser Stufe noch nicht verfügbar.</p>}
        </section> : null}
        {showDiffReview ? <Suspense fallback={<p role="status">Diff-Ansicht wird geladen…</p>}><ReviewDiffPanel key={`diff-${card.id}`} cardId={card.id} projectId={card.projectId} focusComment={criterionReviewFocus ?? focusReviewComment} /></Suspense> : null}
        <div className="drawer-divider" />
        <PrDraftPanel key={`pr-${card.id}`} cardId={card.id} />
      </div>
    </aside>
  </div>;
}
