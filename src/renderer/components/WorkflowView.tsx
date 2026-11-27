import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitBranch, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { Card, Column, ColumnEffort, ProjectSnapshot, Workflow, WorkflowStep } from '../../shared/types';
import type { QueueResults } from '../../shared/queue-results';
import type { LanguagePreference } from '../language';
import type { Mutate } from './shared';
import { WorkflowPlanner } from './WorkflowPlanner';
import { WorkflowStepRows } from './WorkflowStepRows';
import { WorkflowRunEvidencePanel } from './WorkflowRunEvidencePanel';
import { WorkflowStepHaltpointControl } from './WorkflowStepHaltpointControl';
import { QueueResultsPanel } from './QueueResultsPanel';
import { QueueStartPreview } from './QueueStartPreview';
import { ProjectViewTabs, type PlanningView } from './ProjectViewTabs';
import { parseQueueDeadline } from '../../shared/queue-deadline';
import '../queue-preview.css';
import './workflow-workbench.css';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; openWorkflow?: { id: string; token: number } | null; openPlan?: { id: string; token: number } | null; queueCommand?: { text: string; token: number } | null; onQueueCommandHandled?: () => void; onOpenCard?: (cardId: string) => void; onOpenSession?: (sessionId: string) => void; onNavigate?: (view: PlanningView) => void; language?: LanguagePreference }

export function workflowPauseCopy(reason: Workflow['pauseReason']): { description: string; action: string } {
  if (reason === 'haltpoint') return { description: 'Der gewählte Haltepunkt wurde nach dem abgeschlossenen Schritt erreicht. Der nächste Schritt wartet auf deine Fortsetzung.', action: 'Nach Haltepunkt fortsetzen' };
  if (reason === 'approval') return { description: 'Freigabe erforderlich: Der nächste Schritt startet erst nach deiner Bestätigung.', action: 'Schritt freigeben' };
  if (reason === 'manual') return { description: 'Der agentenlose Schritt wurde verschoben und wartet auf deine Bestätigung.', action: 'Schritt abschließen' };
  if (reason === 'review') return { description: 'Ein Agentenlauf muss geprüft werden. Öffne die betroffene Karte, bevor du diesen Schritt erneut startest.', action: 'Schritt erneut starten' };
  if (reason === 'wireframe') return { description: 'Diese Karte verlangt vor dem Agentenstart einen gespeicherten und aktuell freigegebenen Wireframe. Öffne die Karte im Designbereich.', action: 'Nach Designfreigabe fortsetzen' };
  return { description: 'Der Workflow ist pausiert. Du kannst ihn fortsetzen.', action: 'Fortsetzen' };
}

export function workflowPauseDescription(workflow: Workflow): string {
  return workflow.startError
    ? `Start vor Agentenlauf fehlgeschlagen: ${workflow.startError.message}. Prüfe Git und Agentenkonfiguration vor einer bewussten Fortsetzung.`
    : workflowPauseCopy(workflow.pauseReason).description;
}

export function QueuePreview({ cards, loading, error, skipBlocked = false }: { cards: Card[]; loading: boolean; error: string | null; skipBlocked?: boolean }) {
  return <div className="queue-preview" aria-label="Nächste freie To-Do-Karten">
    <strong>{skipBlocked ? 'Nächste startbare To-Do-Karten' : 'Nächste freie To-Do-Karten'}</strong>
    {loading ? <p className="section-copy" role="status">Reihenfolge wird geladen …</p>
      : error ? <p className="inline-note" role="status">{error}</p>
        : cards.length ? <ol>{cards.map((card) => <li key={card.id}>{card.title}</li>)}</ol>
          : <p className="section-copy">{skipBlocked ? 'Keine startbare To-Do-Karte vorhanden. Karten mit offenen Vorgängern bleiben im Board.' : 'Keine freie To-Do-Karte vorhanden.'}</p>}
    <p className="section-copy">Diese Vorschau startet nichts. Änderungen im Board gelten für die nächste noch freie Karte.</p>
  </div>;
}

export function orderedStepColumns(columns: Column[], selectedIds: string[], previousSteps: WorkflowStep[] = []): Column[] {
  const previous = new Map(previousSteps.map((step, index) => [step.columnId, index]));
  return columns.filter((column) => selectedIds.includes(column.id)).sort((a, b) => {
    const first = previous.get(a.id);
    const second = previous.get(b.id);
    if (first !== undefined && second !== undefined) return first - second;
    if (first !== undefined) return -1;
    if (second !== undefined) return 1;
    return a.position - b.position;
  });
}

export function stepAgentId(column: Column, overrides: Record<string, string>): string | null {
  return (overrides[column.id] ?? column.agentId) || null;
}

export function stepsFromForm(
  columns: Column[], selectedIds: string[], previousSteps: WorkflowStep[],
  agentByColumn: Record<string, string>, modelByColumn: Record<string, string>,
  effortByColumn: Record<string, string>, approvalIds: string[], worktreeIds: string[] = [],
  parallelIds: string[] = [],
): WorkflowStep[] {
  return orderedStepColumns(columns, selectedIds, previousSteps).map((column) => ({
    id: previousSteps.find((step) => step.columnId === column.id)?.id ?? crypto.randomUUID(),
    columnId: column.id,
    agentId: stepAgentId(column, agentByColumn),
    model: modelByColumn[column.id]?.trim() || null,
    effort: (effortByColumn[column.id] || null) as ColumnEffort | null,
    requireApproval: approvalIds.includes(column.id),
    useWorktree: Boolean(stepAgentId(column, agentByColumn)) && worktreeIds.includes(column.id),
    parallel: Boolean(stepAgentId(column, agentByColumn)) && worktreeIds.includes(column.id) && parallelIds.includes(column.id),
  }));
}

export function WorkflowView({ snapshot, mutate, openWorkflow, openPlan, queueCommand, onQueueCommandHandled, onOpenCard, onOpenSession, onNavigate, language }: Props) {
  const columns = useMemo(() => [...snapshot.columns].sort((a, b) => a.position - b.position), [snapshot.columns]);
  const hasTodoColumn = columns.some((column) => column.name.trim().toLocaleLowerCase('de-DE') === 'to do');
  const [showForm, setShowForm] = useState(false);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [stepIds, setStepIds] = useState<string[]>([]);
  const [approvalIds, setApprovalIds] = useState<string[]>([]);
  const [worktreeIds, setWorktreeIds] = useState<string[]>([]);
  const [parallelIds, setParallelIds] = useState<string[]>([]);
  const [agentByColumn, setAgentByColumn] = useState<Record<string, string>>({});
  const [modelByColumn, setModelByColumn] = useState<Record<string, string>>({});
  const [effortByColumn, setEffortByColumn] = useState<Record<string, string>>({});
  const [queueTemplateId, setQueueTemplateId] = useState(snapshot.queue.templateWorkflowId ?? '');
  const [queueHours, setQueueHours] = useState(0);
  const [queueUntilText, setQueueUntilText] = useState('');
  const [queueUntilError, setQueueUntilError] = useState('');
  const [queueStartRequest, setQueueStartRequest] = useState<{ projectId: string; templateId: string; hours: number; endAt?: string } | null>(null);
  const [skipWorkflowId, setSkipWorkflowId] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState('');
  const [deleteWorkflowId, setDeleteWorkflowId] = useState<string | null>(null);
  const [queuePreview, setQueuePreview] = useState<{ projectId: string; cards: Card[]; error: string | null } | null>(null);
  const [queueReport, setQueueReport] = useState<{ projectId: string; results: QueueResults | null; error: string | null } | null>(null);
  const [queueReportRetry, setQueueReportRetry] = useState(0);
  const skipWorkflow = snapshot.workflows.find((item) => item.id === skipWorkflowId);
  const skipCardTitle = snapshot.cards.find((item) => item.id === skipWorkflow?.cardIds[0])?.title ?? skipWorkflow?.name ?? 'Unbekannte Karte';
  const deleteWorkflow = snapshot.workflows.find((item) => item.id === deleteWorkflowId);

  useEffect(() => { setQueueTemplateId(snapshot.queue.templateWorkflowId ?? ''); }, [snapshot.project.id, snapshot.queue.templateWorkflowId]);
  useEffect(() => { setSkipWorkflowId(null); setSkipReason(''); setDeleteWorkflowId(null); setShowForm(false); setEditingWorkflowId(null); setQueueHours(0); setQueueUntilText(''); setQueueUntilError(''); setQueueStartRequest(null); }, [snapshot.project.id]);
  const closeQueueStart = useCallback(() => setQueueStartRequest(null), []);
  useEffect(() => {
    if (!queueCommand) return;
    try {
      const endAt = parseQueueDeadline(queueCommand.text);
      setQueueHours(-1); setQueueUntilText(queueCommand.text); setQueueUntilError('');
      if (queueTemplateId && hasTodoColumn && snapshot.queue.state !== 'running')
        setQueueStartRequest({ projectId: snapshot.project.id, templateId: queueTemplateId, hours: 0, endAt });
      else setQueueUntilError(snapshot.queue.state === 'running' ? 'Die Queue läuft bereits.' : 'Wähle zuerst eine Workflow-Route und starte danach den geprüften Lauf.');
    } catch (reason) { setQueueUntilError(reason instanceof Error ? reason.message : String(reason)); }
    onQueueCommandHandled?.();
  }, [queueCommand?.token]);
  function openQueueStart() {
    try {
      const endAt = queueHours === -1 ? parseQueueDeadline(queueUntilText) : undefined;
      setQueueUntilError('');
      setQueueStartRequest({ projectId: snapshot.project.id, templateId: queueTemplateId, hours: endAt ? 0 : queueHours, endAt });
    } catch (reason) { setQueueUntilError(reason instanceof Error ? reason.message : String(reason)); }
  }
  useEffect(() => {
    let active = true;
    const projectId = snapshot.project.id;
    void window.studio.queueCandidates(projectId).then(
      (cards) => { if (active) setQueuePreview({ projectId, cards, error: null }); },
      (error: unknown) => { if (active) setQueuePreview({ projectId, cards: [], error: error instanceof Error ? error.message : 'Vorschau nicht verfügbar.' }); },
    );
    return () => { active = false; };
  }, [snapshot]);
  useEffect(() => {
    let active = true;
    const projectId = snapshot.project.id;
    void window.studio.queueResults(projectId).then(
      (results) => { if (active) setQueueReport({ projectId, results, error: null }); },
      (error: unknown) => { if (active) setQueueReport({ projectId, results: null, error: error instanceof Error ? error.message : 'Abfrage nicht verfügbar.' }); },
    );
    return () => { active = false; };
  }, [snapshot, queueReportRetry]);

  useEffect(() => { if (openWorkflow) document.getElementById(`workflow-${openWorkflow.id}`)?.scrollIntoView({ block: 'center' }); }, [openWorkflow?.id, openWorkflow?.token, snapshot.project.id]);

  function toggle(id: string, values: string[], update: (next: string[]) => void) {
    update(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  }

  function newDraft() {
    setEditingWorkflowId(null);
    setName('');
    setCardIds([]);
    setStepIds([]);
    setApprovalIds([]);
    setWorktreeIds([]);
    setParallelIds([]);
    setAgentByColumn({});
    setModelByColumn({});
    setEffortByColumn({});
    setShowForm(true);
  }

  function editDraft(workflow: Workflow) {
    setEditingWorkflowId(workflow.id);
    setName(workflow.name);
    setCardIds([...workflow.cardIds]);
    setStepIds(workflow.steps.map((step) => step.columnId));
    setApprovalIds(workflow.steps.filter((step) => step.requireApproval).map((step) => step.columnId));
    setWorktreeIds(workflow.steps.filter((step) => step.useWorktree).map((step) => step.columnId));
    setParallelIds(workflow.steps.filter((step) => step.parallel).map((step) => step.columnId));
    setAgentByColumn(Object.fromEntries(workflow.steps.map((step) => [step.columnId, step.agentId ?? ''])));
    setModelByColumn(Object.fromEntries(workflow.steps.map((step) => [step.columnId, step.model ?? ''])));
    setEffortByColumn(Object.fromEntries(workflow.steps.map((step) => [step.columnId, step.effort ?? ''])));
    setShowForm(true);
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const previousSteps = snapshot.workflows.find((workflow) => workflow.id === editingWorkflowId)?.steps ?? [];
    const steps = stepsFromForm(columns, stepIds, previousSteps, agentByColumn, modelByColumn, effortByColumn, approvalIds, worktreeIds, parallelIds);
    const created = editingWorkflowId
      ? await mutate(() => window.studio.updateDraftWorkflow({ id: editingWorkflowId, name: name.trim(), cardIds, steps }))
      : await mutate(() => window.studio.createWorkflow({ projectId: snapshot.project.id, name: name.trim(), cardIds, steps }));
    if (created) { setShowForm(false); setEditingWorkflowId(null); setName(''); setCardIds([]); setStepIds([]); setApprovalIds([]); setWorktreeIds([]); setParallelIds([]); setAgentByColumn({}); setModelByColumn({}); setEffortByColumn({}); }
  }

  async function skipQueuedCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!skipWorkflowId) return;
    const result = await mutate(() => window.studio.skipQueuedCard({ projectId: snapshot.project.id, workflowId: skipWorkflowId, reason: skipReason }));
    if (result) { setSkipWorkflowId(null); setSkipReason(''); }
  }

  async function deleteDraftWorkflow() {
    if (!deleteWorkflowId || deleteWorkflow?.state !== 'draft') return;
    const result = await mutate(() => window.studio.deleteDraftWorkflow(deleteWorkflowId));
    if (result) setDeleteWorkflowId(null);
  }

  return <div className="standard-page workflow-workbench">
    <ProjectViewTabs active="workflows" onNavigate={(view) => onNavigate?.(view)} disabled={!onNavigate} language={language} />
    <div className="view-header"><div><h2>Workflows</h2><p>Ein Workflow ist die Route einer Karte: Spalten in Reihenfolge, jeweils mit Agent oder manuellem Schritt. Ein Entwurf startet noch nichts.</p></div><button className="secondary-button" type="button" onClick={newDraft}><Plus size={17} /> Neuer Workflow</button></div>

    <WorkflowPlanner snapshot={snapshot} mutate={mutate} openPlan={openPlan} />

    {skipWorkflowId ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSkipWorkflowId(null); }}><form className="dialog" onSubmit={(event) => void skipQueuedCard(event)}><div className="dialog-heading"><div><small>QUEUE-ENTSCHEIDUNG</small><h2>Karte überspringen</h2></div><button className="icon-button" type="button" onClick={() => setSkipWorkflowId(null)} aria-label="Schließen">×</button></div><p><strong>{skipCardTitle}</strong></p><p>Der bisherige Workflow und seine Sitzungsprotokolle bleiben erhalten. Diese Karte wird nicht automatisch erneut eingeplant. Danach bleibt die Queue angehalten, bis du sie ausdrücklich aktivierst.</p><label>Grund für das Überspringen<textarea autoFocus required minLength={3} maxLength={500} rows={3} value={skipReason} onChange={(event) => setSkipReason(event.target.value)} placeholder="Zum Beispiel: externer Dienst nicht erreichbar" /></label><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setSkipWorkflowId(null)}>Abbrechen</button><button className="primary-button" type="submit" disabled={skipReason.trim().length < 3}>Karte überspringen</button></div></form></div> : null}
    {queueStartRequest?.projectId === snapshot.project.id ? <QueueStartPreview {...queueStartRequest} mutate={mutate} onClose={closeQueueStart} /> : null}
    {deleteWorkflow ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteWorkflowId(null); }}><div className="dialog" role="dialog" aria-modal="true" aria-label="Workflow-Entwurf löschen"><div className="dialog-heading"><div><small>ENTWURF ENTFERNEN</small><h2>Workflow-Entwurf löschen?</h2></div><button className="icon-button" type="button" onClick={() => setDeleteWorkflowId(null)} aria-label="Schließen">×</button></div><p><strong>{deleteWorkflow.name}</strong></p><p>Nur dieser ungestartete Ablauf wird entfernt. Seine Karten und Dateien bleiben erhalten. Freie To-Do-Karten können danach wieder von der Warteschlange aufgenommen werden.</p><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeleteWorkflowId(null)}>Abbrechen</button><button className="danger-button" type="button" onClick={() => void deleteDraftWorkflow()}>Entwurf endgültig löschen</button></div></div></div> : null}

    <section className="workflow-card" aria-label="Automatische Warteschlange">
      <div className="workflow-card-top"><div><h3>Automatische Warteschlange</h3><p>Wähle eine gespeicherte Route. Branchloom nimmt dann freie To-Do-Karten nacheinander auf; du kannst jederzeit pausieren.</p></div><span className={`state-badge ${snapshot.queue.state === 'off' ? 'draft' : snapshot.queue.state}`}>{snapshot.queue.state === 'running' ? 'Aktiv' : snapshot.queue.state === 'paused' ? 'Pausiert' : 'Aus'}</span></div>
      <label className="field-label">Workflow-Route<select value={queueTemplateId} disabled={snapshot.queue.state === 'running' || Boolean(snapshot.queue.activeWorkflowId)} onChange={(event) => setQueueTemplateId(event.target.value)}><option value="">Route wählen</option>{snapshot.workflows.filter((workflow) => workflow.id !== snapshot.queue.activeWorkflowId).map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label>
      <label className="field-label">Automatisch anhalten nach<select value={queueHours} disabled={snapshot.queue.state === 'running'} onChange={(event) => { setQueueHours(Number(event.target.value)); setQueueUntilError(''); }}><option value={0}>Ohne Zeitlimit</option><option value={1}>1 Stunde</option><option value={4}>4 Stunden</option><option value={8}>8 Stunden</option><option value={-1}>Uhrzeit festlegen</option></select></label>
      {queueHours === -1 && snapshot.queue.state !== 'running' ? <label className="field-label">Bis wann?<input value={queueUntilText} onChange={(event) => { setQueueUntilText(event.target.value); setQueueUntilError(''); }} placeholder="bis 20 Uhr · bis morgen 08:30 Uhr" aria-describedby="queue-until-help" /><small id="queue-until-help">Die nächste passende Uhrzeit innerhalb von 24 Stunden. Den konkreten Zeitpunkt siehst du vor dem Start.</small></label> : null}
      {queueUntilError ? <p className="inline-error" role="alert">{queueUntilError}</p> : null}
      {snapshot.queue.state === 'running' ? <p className="section-copy" role="status">{snapshot.queue.runUntil ? `Keine neuen Karten nach ${new Date(snapshot.queue.runUntil).toLocaleString('de-DE')}.` : 'Für diesen Lauf ist keine Endzeit gesetzt.'} Ein bereits gestarteter Agent wird zur Endzeit nicht abgebrochen.</p> : <p className="section-copy">Die gewählte Dauer beginnt mit jedem bewussten Start oder Fortsetzen erneut. Nach Ablauf bleiben Karten und Agentenverlauf erhalten; laufende Schritte werden nicht abgebrochen.</p>}
      <label className="queue-policy"><input type="checkbox" checked={snapshot.queue.continueBlocked === true} disabled={snapshot.queue.state === 'running'} onChange={(event) => { const enabled = event.currentTarget.checked; void mutate(() => window.studio.setQueueContinueBlocked({ projectId: snapshot.project.id, enabled })); }} /><span>Bei blockierten Karten mit anderen Aufgaben weitermachen</span></label>
      <label className="queue-policy"><input type="checkbox" checked={snapshot.queue.autoResumeIdle === true} disabled={snapshot.queue.state === 'running'} onChange={(event) => { const enabled = event.currentTarget.checked; void mutate(() => window.studio.setQueueAutoResumeIdle({ projectId: snapshot.project.id, enabled })); }} /><span>Ruhende Queue nach Netzrückkehr fortsetzen</span></label>
      <label className="queue-policy"><input type="checkbox" checked={snapshot.queue.autoTest === true} disabled={snapshot.queue.state === 'running'} onChange={(event) => { const enabled = event.currentTarget.checked; void mutate(() => window.studio.setQueueAutoTest({ projectId: snapshot.project.id, enabled, confirm: enabled })); }} /><span>Abgeschlossene Queue-Karten automatisch mit npm prüfen</span></label>
      <p className="section-copy">Vorher im Kartendrawer ein npm-Integrationstestskript für das Projekt wählen. Nach einer abgeschlossenen Karte mit committeten Änderungen im Karten-Worktree läuft das Skript einmal in einem getrennten Checkout, bevor die nächste Karte startet. Das Skript selbst kann mit deinen Benutzerrechten weitere Aktionen ausführen. Fehlende Commits, ein blockierter Git-Stand oder ein nicht bestandener Test halten die Queue an; Integration und Push bleiben getrennte Entscheidungen.</p>
      <p className="section-copy">Nur wenn noch kein Workflow aktiv war und kein Agent läuft, kann die Queue nach einem Geräte-Offline-Signal innerhalb ihrer Frist weitergehen. Begonnene Schritte, Nutzer-Pause und App-Neustart brauchen weiter eine bewusste Prüfung. Diese Einstellungen ändern keine CLI- oder Git-Rechte.</p>
      <p className="section-copy">{snapshot.queue.completedCount} Karten abgeschlossen. Die Queue startet nur freie, nicht archivierte To-Do-Karten ohne bestehenden Workflow. Bewusstes Pausieren stoppt den laufenden Agenten; eine Netzpause lässt den bestehenden Prozess in Ruhe. Arbeit und Protokoll bleiben erhalten. CLI-Agenten laufen mit deinen Benutzerrechten im Projektordner; die App selbst pusht keine Git-Änderungen.</p>
      <QueuePreview cards={queuePreview?.projectId === snapshot.project.id ? queuePreview.cards : []} loading={queuePreview?.projectId !== snapshot.project.id} error={queuePreview?.projectId === snapshot.project.id ? queuePreview.error : null} skipBlocked={snapshot.queue.continueBlocked === true} />
      {!hasTodoColumn ? <p className="inline-note" role="status">Zum Aktivieren der Warteschlange braucht dieses Board eine Spalte namens To Do.</p> : null}
      {snapshot.queue.activeWorkflowId ? <p className="section-copy">Aktiver Ablauf: <a href={`#workflow-${snapshot.queue.activeWorkflowId}`}>{snapshot.workflows.find((workflow) => workflow.id === snapshot.queue.activeWorkflowId)?.name ?? 'Workflow öffnen'}</a>. Nach Unterbrechung den Ablauf prüfen und ausdrücklich fortsetzen.</p> : null}
      {snapshot.queue.pauseReason ? <p className="inline-note" role="status">{snapshot.queue.pauseReason}</p> : null}
      <div className="workflow-actions"><span>{snapshot.queue.state === 'running' ? 'Aktiv oder wartet auf neue To-Do-Karten.' : snapshot.queue.state === 'paused' ? 'Neue Karten starten erst nach Fortsetzung.' : 'Neue Karten starten nicht automatisch.'}</span>
        {snapshot.queue.state !== 'running' ? <button className="primary-button small" type="button" disabled={!queueTemplateId || !hasTodoColumn} onClick={openQueueStart}><Play size={14} /> {snapshot.queue.state === 'paused' ? 'Queue fortsetzen' : 'Queue aktivieren'}</button> : <button className="secondary-button small" type="button" onClick={() => void mutate(() => window.studio.setProjectQueue({ projectId: snapshot.project.id, state: 'paused' }))}><Pause size={14} /> Queue pausieren</button>}
        {snapshot.queue.state !== 'off' ? <button className="secondary-button small" type="button" onClick={() => void mutate(() => window.studio.setProjectQueue({ projectId: snapshot.project.id, state: 'off' }))}>Ausschalten</button> : null}
      </div>
      {snapshot.queue.state !== 'running' && snapshot.queue.activeWorkflowId && snapshot.workflows.find((item) => item.id === snapshot.queue.activeWorkflowId)?.state === 'paused' ? <div className="workflow-actions"><span>Wenn diese Karte blockiert bleibt, kannst du sie mit Begründung überspringen. Der Verlauf bleibt erhalten. Die nächste Karte startet erst nach ausdrücklichem Aktivieren der Queue.</span><button className="secondary-button small" type="button" onClick={() => setSkipWorkflowId(snapshot.queue.activeWorkflowId)}>Aktive Karte überspringen</button></div> : null}
      <QueueResultsPanel results={queueReport?.projectId === snapshot.project.id ? queueReport.results : null} error={queueReport?.projectId === snapshot.project.id ? queueReport.error : null} onRetry={() => setQueueReportRetry((value) => value + 1)} onOpenCard={onOpenCard} onOpenSession={onOpenSession} />
    </section>

    <div className="workflow-list-heading"><h3>Gespeicherte Workflows</h3><span>{snapshot.workflows.length}</span></div>
    {snapshot.workflows.length === 0 ? <div className="feature-empty"><GitBranch size={30} /><h3>Noch kein Workflow</h3><p>Plane einen Ablauf mit dem Workflow-Agenten oder lege Karten und Schritte manuell fest.</p><button className="secondary-button" type="button" onClick={newDraft}>Manuell anlegen</button></div> : <div className="workflow-list">{[...snapshot.workflows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((workflow) => <article className={openWorkflow?.id === workflow.id ? 'workflow-card search-target' : 'workflow-card'} id={`workflow-${workflow.id}`} key={workflow.id}><div className="workflow-card-top"><div><span className="workflow-kicker"><GitBranch size={14} /> WORKFLOW</span><h3>{workflow.name}</h3><p>{workflow.cardIds.length} Karten · {workflow.steps.length} Schritte</p></div><span className={`state-badge ${workflow.state}`}>{workflow.state === 'running' ? 'Läuft' : workflow.queueSkip ? 'Übersprungen' : workflow.state === 'paused' ? 'Pausiert' : workflow.state === 'done' ? 'Fertig' : 'Entwurf'}</span></div><div className="workflow-route">{workflow.steps.map((step, index) => <div className={index === workflow.currentStep && workflow.state === 'paused' ? 'route-step paused' : index === workflow.currentStep && workflow.state === 'running' ? 'route-step current' : 'route-step'} aria-current={index === workflow.currentStep && (workflow.state === 'paused' || workflow.state === 'running') ? 'step' : undefined} key={step.id}><span className="route-number">{index + 1}</span><span><strong>{columns.find((column) => column.id === step.columnId)?.name ?? 'Entfernte Spalte'}</strong><small>{snapshot.agents.find((agent) => agent.id === step.agentId)?.name ?? 'Kein Agent'}{step.model ? ` · ${step.model}` : ''}{step.effort ? ` · ${step.effort}` : ''}{step.useWorktree ? ' · Karten-Worktree' : ''}{step.parallel ? ' · Karten parallel' : ''}{step.requireApproval ? ' · Freigabe' : ''}{index === workflow.currentStep && workflow.state === 'paused' ? ' · Hier pausiert' : ''}</small></span>{index < workflow.steps.length - 1 ? <ArrowRight size={16} /> : null}</div>)}</div><div className="workflow-actions"><span>{workflow.queueSkip ? `Übersprungen am ${new Date(workflow.queueSkip.at).toLocaleString()}: ${workflow.queueSkip.reason}` : workflow.state === 'paused' ? workflowPauseDescription(workflow) : workflow.state === 'draft' ? 'Bereit für den ersten Start.' : workflow.state === 'running' ? `Schritt ${Math.min(workflow.currentStep + 1, workflow.steps.length)} von ${workflow.steps.length}` : 'Alle Schritte abgeschlossen.'}</span>{workflow.state === 'running' ? <button className="secondary-button small" type="button" onClick={() => void mutate(() => window.studio.setWorkflowState({ id: workflow.id, state: 'paused' }))}><Pause size={14} /> Pausieren</button> : (workflow.state === 'draft' || workflow.state === 'paused') && !workflow.queueSkip ? <button className="primary-button small" type="button" onClick={() => void mutate(() => window.studio.setWorkflowState({ id: workflow.id, state: 'running' }))}><Play size={14} /> {workflow.state === 'paused' ? workflowPauseCopy(workflow.pauseReason).action : 'Starten'}</button> : null}{workflow.state === 'draft' ? <button className="secondary-button small" type="button" onClick={() => editDraft(workflow)}><Pencil size={14} /> Entwurf bearbeiten</button> : null}{workflow.state === 'draft' ? <button className="secondary-button small" type="button" onClick={() => setDeleteWorkflowId(workflow.id)}><Trash2 size={14} /> Entwurf löschen</button> : null}</div><WorkflowStepHaltpointControl workflow={workflow} columns={columns} mutate={mutate} /><WorkflowRunEvidencePanel projectId={snapshot.project.id} workflow={workflow} columns={columns} onOpenCard={onOpenCard} onOpenSession={onOpenSession} /></article>)}</div>}

    {showForm ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="dialog wide" onSubmit={(event) => void create(event)}><div className="dialog-heading"><div><small>NEUER ABLAUF</small><h2>{editingWorkflowId ? 'Workflow-Entwurf bearbeiten' : 'Workflow erstellen'}</h2></div><button className="icon-button" type="button" onClick={() => setShowForm(false)} aria-label="Schließen">×</button></div><label>Name<input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Zum Beispiel: Implementieren und prüfen" /></label><div className="form-section"><strong>Karten</strong><p>Wähle mindestens eine Karte für diesen Ablauf.</p><div className="option-grid">{snapshot.cards.length ? snapshot.cards.map((card) => <label className="check-option" key={card.id}><input type="checkbox" checked={cardIds.includes(card.id)} onChange={() => toggle(card.id, cardIds, setCardIds)} /><span>{card.title}</span></label>) : <span className="field-help">Lege zuerst eine Karte im Board an.</span>}</div></div><div className="form-section"><strong>Schritte</strong><p>Wähle Spalten, Agenten, Modell, Effort, optionalen Karten-Worktree und Freigaben. Parallele Kartenläufe brauchen einen eigenen Worktree je Karte. Ein Schritt ohne Agent bleibt manuell. {editingWorkflowId ? 'Die bestehende Schrittfolge bleibt erhalten; neu gewählte Spalten werden angehängt.' : 'Neue Routen folgen der Board-Reihenfolge.'}</p>{editingWorkflowId && stepIds.length ? <p className="inline-note">Reihenfolge: {orderedStepColumns(columns, stepIds, snapshot.workflows.find((workflow) => workflow.id === editingWorkflowId)?.steps).map((column) => column.name).join(' → ')}</p> : null}<WorkflowStepRows columns={columns} agents={snapshot.agents} selectedIds={stepIds} approvalIds={approvalIds} worktreeIds={worktreeIds} parallelIds={parallelIds} agentByColumn={agentByColumn} modelByColumn={modelByColumn} effortByColumn={effortByColumn} toggleStep={(id) => toggle(id, stepIds, setStepIds)} toggleApproval={(id) => toggle(id, approvalIds, setApprovalIds)} toggleWorktree={(id) => { toggle(id, worktreeIds, setWorktreeIds); if (worktreeIds.includes(id)) setParallelIds((old) => old.filter((item) => item !== id)); }} toggleParallel={(id) => toggle(id, parallelIds, setParallelIds)} changeAgent={(id, agentId) => { setAgentByColumn((old) => ({ ...old, [id]: agentId })); setModelByColumn((old) => ({ ...old, [id]: '' })); setEffortByColumn((old) => ({ ...old, [id]: '' })); setWorktreeIds((old) => old.filter((item) => item !== id)); setParallelIds((old) => old.filter((item) => item !== id)); }} changeModel={(id, model) => setModelByColumn((old) => ({ ...old, [id]: model }))} changeEffort={(id, effort) => setEffortByColumn((old) => ({ ...old, [id]: effort }))} /></div><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Abbrechen</button><button className="primary-button" type="submit" disabled={cardIds.length === 0 || stepIds.length === 0}>{editingWorkflowId ? 'Änderungen speichern' : 'Workflow anlegen'}</button></div></form></div> : null}
  </div>;
}
