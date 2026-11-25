import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Bot, BrainCircuit, CircleAlert, CircleStop, Clock3, Columns3, Download, GitBranch, Search, X } from 'lucide-react';
import type { ProjectSnapshot, Session } from '../../shared/types';
import { activityItems, formatDuration, sessionDuration, type ActivityKindFilter, type ActivityStatusFilter } from '../activity-data';
import { readableSessionOutput, serializeSessionTranscript, sessionTranscriptFileName } from '../activity-transcript';
import { UsagePanel } from './UsagePanel';
import '../activity.css';

interface Props { snapshot: ProjectSnapshot; openSession?: { id: string; token: number } | null; onSessionClosed?: () => void; onOpenCard: (id: string) => void; onOpenWorkflow: (id: string) => void; onSaveSessionAsNote?: (session: Session) => Promise<void> }

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : 'nicht erfasst';
}

export function ActivityView({ snapshot, openSession, onSessionClosed, onOpenCard, onOpenWorkflow, onSaveSessionAsNote }: Props) {
  const [section, setSection] = useState<'activity' | 'usage'>('activity');
  const [kind, setKind] = useState<ActivityKindFilter>('all');
  const [status, setStatus] = useState<ActivityStatusFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [externalSession, setExternalSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const transcriptDialog = useRef<HTMLElement | null>(null);
  const transcriptOpener = useRef<HTMLElement | null>(null);
  const activitySearch = useRef<HTMLInputElement | null>(null);
  const selectedInSnapshot = Boolean(selectedSessionId && snapshot.sessions.some((item) => item.id === selectedSessionId));
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setSelectedSessionId(null); setExternalSession(null); transcriptOpener.current = null; }, [snapshot.project.id]);
  useEffect(() => {
    if (openSession) {
      // Deep links can arrive after their original view has unmounted. Return
      // to the activity search rather than focusing the document body.
      transcriptOpener.current = null;
      setSection('activity');
      setSelectedSessionId(openSession.id);
    }
  }, [openSession?.id, openSession?.token]);
  useEffect(() => {
    if (!selectedSessionId || selectedInSnapshot) { setExternalSession(null); setSessionLoading(false); setSessionError(''); return; }
    let active = true;
    setSessionLoading(true);
    setSessionError('');
    void window.studio.sessionForProject({ projectId: snapshot.project.id, sessionId: selectedSessionId })
      .then((value) => { if (active) setExternalSession(value); })
      .catch(() => { if (active) setSessionError('Dieser gespeicherte Verlauf konnte nicht geladen werden.'); })
      .finally(() => { if (active) setSessionLoading(false); });
    return () => { active = false; };
  }, [selectedSessionId, snapshot.project.id, selectedInSnapshot]);
  function openTranscript(sessionId: string, opener: HTMLElement) {
    transcriptOpener.current = opener;
    setSelectedSessionId(sessionId);
  }
  function closeTranscript() {
    const opener = transcriptOpener.current;
    transcriptOpener.current = null;
    setSelectedSessionId(null);
    setExternalSession(null);
    onSessionClosed?.();
    window.setTimeout(() => {
      if (opener?.isConnected && opener.getClientRects().length > 0) opener.focus();
      else activitySearch.current?.focus();
    }, 0);
  }
  function keepFocusInTranscript(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab' || !transcriptDialog.current) return;
    const dialog = transcriptDialog.current;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const current = document.activeElement;
    const focusOnControl = focusable.some((element) => element === current);
    if (event.shiftKey && (current === first || !focusOnControl)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (current === last || !focusOnControl)) {
      event.preventDefault(); first.focus();
    }
  }
  useEffect(() => {
    if (!selectedSessionId) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeTranscript(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedSessionId, onSessionClosed]);

  const rows = useMemo(() => activityItems(snapshot, now, kind), [snapshot, now, kind]);
  const filtered = useMemo(() => rows.filter((item) => (status === 'all' || item.status === status) && `${item.title} ${item.subtitle} ${item.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [rows, status, query]);
  const shown = filtered.slice(0, 100);
  const selectedSession = snapshot.sessions.find((item) => item.id === selectedSessionId) ?? (externalSession?.id === selectedSessionId ? externalSession : null);
  const cardIdsWithRuns = new Set(snapshot.sessions.map((session) => session.cardId));
  const runningCount = snapshot.sessions.filter((session) => session.state === 'running').length + snapshot.workflows.filter((workflow) => workflow.state === 'running').length;
  const attentionCount = snapshot.sessions.filter((session) => session.state === 'failed' || (session.state === 'exited' && session.exitCode !== null && session.exitCode !== 0)).length + snapshot.workflows.filter((workflow) => workflow.state === 'paused' && ['approval', 'manual', 'review'].includes(workflow.pauseReason ?? '')).length;
  const stoppedCount = snapshot.sessions.filter((session) => session.state === 'stopped').length;
  const untouchedCount = snapshot.cards.filter((card) => !cardIdsWithRuns.has(card.id)).length;

  function exportTranscript(session: Session) {
    const cardTitle = snapshot.cards.find((card) => card.id === session.cardId)?.title ?? 'Entfernte Karte';
    const agentName = snapshot.agents.find((agent) => agent.id === session.agentId)?.name ?? 'Entfernter Agent';
    const blob = new Blob([serializeSessionTranscript(session, cardTitle, agentName)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sessionTranscriptFileName(session.id);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function saveAsNote(session: Session) {
    if (!onSaveSessionAsNote || savingNote || session.state === 'running') return;
    setSavingNote(true);
    try { await onSaveSessionAsNote(session); }
    finally { setSavingNote(false); }
  }

  return <div className="standard-page activity-page">
    <div className="view-header"><div><div className="eyebrow">PROJEKTAKTIVITÄT</div><h2>{section === 'activity' ? 'Was gerade passiert' : 'Nutzung im Projekt'}</h2><p>{section === 'activity' ? 'Gespeicherte Agentenläufe, Workflows und Karten ohne Lauf. Zeiten stammen aus dem lokalen Projektstand.' : 'Tatsächliche Läufe und Laufzeiten aus diesem Projekt, ohne geschätzte Modellkosten.'}</p></div></div>
    <div className="activity-section-switch" role="group" aria-label="Aktivitätsbereich"><button type="button" aria-pressed={section === 'activity'} onClick={() => setSection('activity')}>Aktivität</button><button type="button" aria-pressed={section === 'usage'} onClick={() => setSection('usage')}>Nutzung</button></div>
    {section === 'usage' ? <UsagePanel snapshot={snapshot} now={now} onShowAgent={(name) => { setKind('session'); setStatus('all'); setQuery(name); setSection('activity'); }} onOpenWorkflow={onOpenWorkflow} onOpenCard={onOpenCard} /> : <>
    <div className="activity-stats" aria-label="Aktivitätsübersicht"><div><Bot size={17} /><strong>{runningCount}</strong><span>Läuft</span></div><div><CircleAlert size={17} /><strong>{attentionCount}</strong><span>Handlungsbedarf</span></div><div><CircleStop size={17} /><strong>{stoppedCount}</strong><span>Gestoppt</span></div><div><Columns3 size={17} /><strong>{untouchedCount}</strong><span>Karten ohne Lauf</span></div></div>
    <div className="activity-filters">
      <label>Art<select value={kind} onChange={(event) => setKind(event.target.value as ActivityKindFilter)}><option value="all">Alle Aktivitäten</option><option value="session">Agentenläufe</option><option value="workflow">Workflows</option><option value="card">Karten mit letztem Lauf</option></select></label>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ActivityStatusFilter)}><option value="all">Alle Status</option><option value="running">Läuft</option><option value="attention">Handlungsbedarf</option><option value="finished">Beendet</option><option value="stopped">Gestoppt</option><option value="paused">Pausiert</option><option value="idle">Noch nicht gestartet</option></select></label>
      <label className="activity-search"><span className="sr-only">Aktivität durchsuchen</span><Search size={16} /><input ref={activitySearch} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titel oder Agent suchen…" aria-label="Aktivität durchsuchen" /></label>
    </div>
    <div className="activity-list" aria-live="polite">{shown.map((item) => {
      const Icon = item.kind === 'session' ? Bot : item.kind === 'workflow' ? GitBranch : Columns3;
      return <article className="activity-item" key={`${item.kind}:${item.id}`}>
        <span className="activity-icon"><Icon size={18} /></span>
        <div className="activity-main">
          <div className="activity-title-row"><h3>{item.title}</h3><span className={`activity-badge ${item.status}`}>{item.statusLabel}</span></div>
          <p>{item.subtitle} · {item.detail}</p>
          <div className="activity-meta"><span><Clock3 size={13} /> {item.kind === 'card' ? 'Letzter Lauf' : item.kind === 'session' ? 'Gestartet' : 'Aktualisiert'}: {item.kind === 'card' && item.status === 'idle' ? 'nicht erfasst' : dateTime(item.timestamp)}</span><span>Dauer: {formatDuration(item.durationMs)}</span>{item.exitCode !== null ? <span>Exit-Code: {item.exitCode}</span> : null}</div>
        </div>
        <div className="activity-row-actions">
          {item.kind === 'session' ? <button className="secondary-button small" type="button" onClick={(event) => openTranscript(item.id, event.currentTarget)}>Verlauf ansehen</button> : null}
          <button className="secondary-button small" type="button" onClick={() => item.kind === 'workflow' ? onOpenWorkflow(item.targetId) : onOpenCard(item.targetId)}><ArrowUpRight size={14} /> {item.kind === 'workflow' ? 'Zum Workflow' : 'Zur Karte'}</button>
        </div>
      </article>;
    })}{filtered.length === 0 ? <div className="feature-empty activity-empty"><Clock3 size={28} /><h3>{rows.length === 0 ? 'Noch keine Aktivität' : 'Keine Treffer'}</h3><p>{rows.length === 0 ? 'Starte einen Agenten auf einer Karte oder lege einen Workflow an. Hier erscheinen dann die gespeicherten Zustände.' : 'Ändere Status, Art oder Suchbegriff.'}</p></div> : null}</div>
    {filtered.length > shown.length ? <p className="activity-more">{filtered.length - shown.length} weitere Einträge. Nutze die Filter, um sie einzugrenzen.</p> : null}
    </>}
    {selectedSessionId ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTranscript(); }}>
      <section ref={transcriptDialog} className="dialog wide activity-transcript-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-transcript-title" tabIndex={-1} onKeyDown={keepFocusInTranscript}>
        <div className="dialog-heading"><div><small>GESPEICHERTER AGENTENLAUF</small><h2 id="activity-transcript-title">{selectedSession ? snapshot.cards.find((card) => card.id === selectedSession.cardId)?.title ?? 'Entfernte Karte' : 'Agentenverlauf'}</h2></div><button className="icon-button" type="button" autoFocus aria-label="Verlauf schließen" onClick={closeTranscript}><X size={18} /></button></div>
        {selectedSession ? <div className="activity-transcript-meta"><span>Beginn: {dateTime(selectedSession.startedAt)}</span><span>Ende: {selectedSession.endedAt ? dateTime(selectedSession.endedAt) : 'läuft'}</span><span>Dauer: {formatDuration(sessionDuration(selectedSession, now))}</span><span>Status: {selectedSession.state}</span><span>Exit-Code: {selectedSession.exitCode ?? 'nicht erfasst'}</span></div> : null}
        <pre className="activity-transcript-output" role="log">{selectedSession ? readableSessionOutput(selectedSession.output) || 'Noch keine Ausgabe gespeichert.' : sessionLoading ? 'Verlauf wird geladen…' : sessionError || 'Verlauf nicht gefunden.'}</pre>
        <div className="dialog-actions">{selectedSession ? <button className="secondary-button" type="button" onClick={() => exportTranscript(selectedSession)}><Download size={15} /> Als Text speichern</button> : null}{selectedSession && onSaveSessionAsNote ? <button className="secondary-button" type="button" disabled={savingNote || selectedSession.state === 'running'} onClick={() => void saveAsNote(selectedSession)}><BrainCircuit size={15} /> {savingNote ? 'Speichert…' : 'In Memory speichern'}</button> : null}<button className="primary-button" type="button" onClick={closeTranscript}>Schließen</button></div>
      </section>
    </div> : null}
  </div>;
}
