import type { ProjectQueue, QueueState, Session, Workflow } from '../shared/types';
import { StudioStore } from './store';
import { WorkflowEngine } from './workflows';
import { detectQueueFailureLoop } from './loop-guard';
import { AgentSpawnError } from './cli';
import { assertProjectCanStart, projectPauseRequested } from './project-pause';

const RETRY_DELAYS_MS = [5_000, 20_000] as const;

function pauseMessage(workflow: Workflow): string {
  if (workflow.pauseReason === 'approval') return 'Workflow wartet auf eine ausdrückliche Schrittfreigabe.';
  if (workflow.pauseReason === 'manual') return 'Workflow wartet auf Bestätigung eines manuellen Schritts.';
  if (workflow.pauseReason === 'review') return 'Agentenlauf prüfen; ein erneuter Start kann eine Aktion wiederholen.';
  if (workflow.pauseReason === 'wireframe') return 'Wireframe zur aktiven Karte im Designbereich speichern und aktuell freigeben. Danach Workflow und Queue bewusst fortsetzen.';
  return 'Aktiven Workflow prüfen und ausdrücklich fortsetzen.';
}

/** Explicit project queue. Restart and any uncertain outcome leave it paused. */
export class ProjectQueueEngine {
  private readonly pumping = new Set<string>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly store: StudioStore, private readonly workflows: WorkflowEngine, private readonly deviceOnline: () => boolean = () => true) {}

  dispose(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  cancelProjectRetry(projectId: string): void { this.clearLaunchRetry(projectId); }

  setState(input: { projectId: string; state: QueueState; templateWorkflowId?: string }): ProjectQueue {
    const current = this.store.projectQueue(input.projectId);
    const templateWorkflowId = input.templateWorkflowId ?? current.templateWorkflowId;
    if (input.state === 'running') {
      assertProjectCanStart(this.store, input.projectId);
      if (!this.deviceOnline()) throw new Error('Gerät meldet offline. Warteschlange nach Netzprüfung bewusst fortsetzen.');
      if (!templateWorkflowId) throw new Error('Zuerst eine Workflow-Route als Vorlage wählen.');
      this.store.queueCandidates(input.projectId, 1); // Validate To Do before persisting a running queue.
      const template = this.store.workflow(templateWorkflowId);
      if (template.projectId !== input.projectId) throw new Error('Workflow-Vorlage gehört zu einem anderen Projekt.');
      if (current.activeWorkflowId) {
        const active = this.store.workflow(current.activeWorkflowId);
        if (active.state !== 'done' && active.state !== 'running') throw new Error(`${pauseMessage(active)} Die Queue setzt diesen Schritt nicht selbst erneut in Gang.`);
        if (active.state === 'done' && active.currentStep < active.steps.length) throw new Error('Aktiver Workflow wurde vorzeitig als erledigt markiert; bitte prüfen.');
      }
      this.store.saveProjectQueue({ projectId: input.projectId, state: 'running', templateWorkflowId, activeWorkflowId: current.activeWorkflowId, pauseReason: null });
      this.pump(input.projectId);
      return this.store.projectQueue(input.projectId);
    }
    if (input.state !== 'paused' && input.state !== 'off') throw new Error('Ungültiger Warteschlangen-Status.');
    this.clearLaunchRetry(input.projectId);
    if (current.activeWorkflowId) {
      const active = this.store.workflow(current.activeWorkflowId);
      if (active.state === 'running') this.workflows.setState({ id: active.id, state: 'paused' });
    }
    return this.store.saveProjectQueue({ projectId: input.projectId, state: input.state, templateWorkflowId, activeWorkflowId: current.activeWorkflowId, pauseReason: input.state === 'paused' ? 'Vom Nutzer pausiert; aktiven Workflow vor Fortsetzung prüfen.' : null });
  }

  onSessionFinished(session: Session): void {
    const current = this.store.projectQueue(session.projectId);
    if (current.state === 'running' && current.activeWorkflowId === this.store.workflowForSession(session.id)?.id) {
      const repeated = detectQueueFailureLoop(this.store, session.projectId);
      if (repeated?.sessionIds[0] === session.id) {
        this.pause(session.projectId, `Drei aufeinanderfolgende Queue-Agentenläufe scheiterten mit demselben Fehler (Exit-Code ${repeated.exitCode}). Letzter Fehler: ${repeated.excerpt}. Prüfe die drei Verläufe und setze die Warteschlange erst bewusst fort.`);
        return;
      }
    }
    this.pump(session.projectId);
  }
  onBoardChanged(projectId: string): void { this.pump(projectId); }

  /** Pause future claims without killing a PTY whose external writes may already have happened. */
  pauseForConnectionLoss(projectId: string): void {
    if (this.store.projectQueue(projectId).state !== 'running') return;
    this.clearLaunchRetry(projectId);
    const current = this.store.projectQueue(projectId);
    this.store.saveProjectQueue({ projectId, state: 'paused', templateWorkflowId: current.templateWorkflowId, activeWorkflowId: current.activeWorkflowId,
      pauseReason: 'Gerät meldete offline. Lauf und mögliche Änderungen prüfen; nach Rückkehr nur bewusst fortsetzen.' });
  }

  private pause(projectId: string, message: string): void {
    this.clearLaunchRetry(projectId);
    const queue = this.store.projectQueue(projectId);
    this.store.saveProjectQueue({ projectId, state: 'paused', templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: queue.activeWorkflowId, pauseReason: message });
  }

  private clearLaunchRetry(projectId: string): void {
    const timer = this.retryTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(projectId);
    this.store.clearQueueLaunchRetry(projectId);
  }

  private scheduleLaunchRetry(projectId: string, workflowId: string, error: AgentSpawnError): void {
    const previous = this.store.queueLaunchRetry(projectId);
    const attemptCount = (previous?.workflowId === workflowId ? previous.attemptCount : 0) + 1;
    if (attemptCount > RETRY_DELAYS_MS.length) {
      this.pause(projectId, `CLI-Start vor Prozessbeginn dreimal fehlgeschlagen. Kein weiterer automatischer Versuch. Letzter Fehler: ${error.message.slice(0, 300)}`);
      return;
    }
    const delay = RETRY_DELAYS_MS[attemptCount - 1]!;
    const retryAt = new Date(Date.now() + delay).toISOString();
    this.store.saveQueueLaunchRetry({ projectId, workflowId, attemptCount, retryAt, lastError: error.message });
    const queue = this.store.projectQueue(projectId);
    this.store.saveProjectQueue({ projectId, state: 'running', templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: workflowId,
      pauseReason: `CLI-Start vor Prozessbeginn fehlgeschlagen (${attemptCount}/${RETRY_DELAYS_MS.length} automatische Wiederholungen). Nächster Versuch ${new Date(retryAt).toLocaleTimeString('de-DE')}. ${error.message.slice(0, 240)}` });
    const old = this.retryTimers.get(projectId);
    if (old) clearTimeout(old);
    this.retryTimers.set(projectId, setTimeout(() => { this.retryTimers.delete(projectId); this.pump(projectId); }, delay));
  }

  private pump(projectId: string): void {
    if (this.pumping.has(projectId) || this.store.projectQueue(projectId).state !== 'running') return;
    if (projectPauseRequested(this.store, projectId)) {
      this.pause(projectId, 'Projektweite sichere Pause angefordert. Queue nach Prüfung bewusst fortsetzen.');
      return;
    }
    if (!this.deviceOnline()) { this.pauseForConnectionLoss(projectId); return; }
    this.pumping.add(projectId);
    try {
      for (let pass = 0; pass < 2; pass += 1) {
        if (projectPauseRequested(this.store, projectId)) {
          this.pause(projectId, 'Projektweite sichere Pause angefordert. Queue nach Prüfung bewusst fortsetzen.');
          return;
        }
        const queue = this.store.projectQueue(projectId);
        if (queue.state !== 'running' || !queue.templateWorkflowId) return;
        if (queue.activeWorkflowId) {
          let active = this.store.workflow(queue.activeWorkflowId);
          if (active.state === 'done' && this.store.queueLaunchRetry(projectId)) this.clearLaunchRetry(projectId);
          if (active.state === 'running') {
            if (this.store.queueLaunchRetry(projectId)) {
              this.clearLaunchRetry(projectId);
              this.store.saveProjectQueue({ projectId, state: 'running', templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: active.id, pauseReason: null });
            }
            return;
          }
          const retry = this.store.queueLaunchRetry(projectId);
          if (retry?.workflowId === active.id && active.state === 'paused') {
            const remaining = Date.parse(retry.retryAt) - Date.now();
            if (remaining > 0) return;
            if (this.store.activeSessionForProject(projectId)) { this.pause(projectId, 'CLI-Startwiederholung abgebrochen: Im Projekt läuft bereits ein Agent. Ablauf prüfen.'); return; }
            try { this.workflows.setState({ id: active.id, state: 'running' }); }
            catch (error) {
              if (error instanceof AgentSpawnError) this.scheduleLaunchRetry(projectId, active.id, error);
              else this.pause(projectId, `Workflow-Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
              return;
            }
            this.clearLaunchRetry(projectId);
            this.store.saveProjectQueue({ projectId, state: 'running', templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: active.id, pauseReason: null });
            active = this.store.workflow(active.id);
            if (active.state === 'running') return;
          }
          if (active.state === 'paused' || active.state === 'draft') { this.pause(projectId, pauseMessage(active)); return; }
          if (active.currentStep < active.steps.length) { this.pause(projectId, 'Aktiver Workflow wurde vorzeitig als erledigt markiert; bitte prüfen.'); return; }
          this.store.saveProjectQueue({ projectId, state: 'running', templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: null, pauseReason: null });
        }
        if (this.store.activeSessionForProject(projectId)) return;
        const next = this.store.nextQueueCard(projectId);
        if (!next) return; // Running but idle: newly created To-Do cards can be picked up.
        const flow = this.store.claimQueueCard(projectId, next.id, queue.templateWorkflowId);
        try { this.workflows.setState({ id: flow.id, state: 'running' }); }
        catch (error) {
          if (error instanceof AgentSpawnError) this.scheduleLaunchRetry(projectId, flow.id, error);
          else this.pause(projectId, `Workflow-Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        const started = this.store.workflow(flow.id);
        if (started.state === 'paused') { this.pause(projectId, pauseMessage(started)); return; }
        if (started.state === 'running') return;
        // A route can finish synchronously only when it has no agent work.
      }
    } catch (error) {
      this.pause(projectId, `Warteschlange angehalten: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pumping.delete(projectId);
    }
  }
}
