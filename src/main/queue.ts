import type { ProjectQueue, QueueState, Session, Workflow } from '../shared/types';
import type { IntegrationTestEvidence } from '../shared/integration-evidence';
import { StudioStore } from './store';
import { WorkflowEngine } from './workflows';
import { detectQueueFailureLoop } from './loop-guard';
import { AgentSpawnError } from './cli';
import { assertProjectCanStart, projectPauseRequested } from './project-pause';
import { enqueueIntegration, prepareIntegration } from './integration-queue';
import { integrationEvidence, runIntegrationTest } from './integration-evidence';

const RETRY_DELAYS_MS = [5_000, 20_000] as const;

/** Automatic receipts belong to this start; manual receipts may follow its preceding pause. */
export function queueTestMatchesActiveStart(store: StudioStore, projectId: string,
  receipt: Pick<IntegrationTestEvidence, 'queueActivationId' | 'startedAt'>): boolean {
  const active = store.db.prepare(`SELECT id, started_at FROM queue_activations
    WHERE project_id = ? AND ended_at IS NULL ORDER BY rowid DESC LIMIT 1`).get(projectId) as { id: string; started_at: string } | undefined;
  if (!active) return false;
  if (receipt.queueActivationId) return receipt.queueActivationId === active.id;
  const previous = store.db.prepare(`SELECT ended_at FROM queue_activations
    WHERE project_id = ? AND id != ? AND ended_at IS NOT NULL ORDER BY rowid DESC LIMIT 1`)
    .get(projectId, active.id) as { ended_at: string } | undefined;
  const boundary = previous?.ended_at ?? active.started_at;
  return Number.isFinite(Date.parse(receipt.startedAt)) && Date.parse(receipt.startedAt) > Date.parse(boundary);
}

/** One opt-in, bounded npm check for the exact prepared source; no merge or push follows. */
export async function testCompletedQueueCard(store: StudioStore, projectId: string, workflowId: string, cardId: string): Promise<void> {
  if (store.projectQueue(projectId).state !== 'running') return;
  const policy = store.db.prepare('SELECT auto_test_script_hash AS hash FROM project_queues WHERE project_id = ?')
    .get(projectId) as { hash: string | null } | undefined;
  if (!policy?.hash) throw new Error('Der freigegebene npm-Skriptstand fehlt. Automatische Tests neu aktivieren.');
  const existing = store.db.prepare('SELECT id FROM integration_items WHERE card_id = ?').get(cardId);
  if (existing) throw new Error('Für diese Karte existiert bereits ein Integrationsstand. Ihn zuerst manuell prüfen.');
  enqueueIntegration(store, cardId);
  const prepared = prepareIntegration(store, cardId);
  if (prepared.state !== 'ready') throw new Error(prepared.reason ?? 'Git-Stand ist für den Test nicht bereit.');
  if (store.projectQueue(projectId).state !== 'running' || store.projectQueue(projectId).activeWorkflowId !== workflowId) return;
  const activation = store.db.prepare(`SELECT id FROM queue_activations
    WHERE project_id = ? AND ended_at IS NULL ORDER BY rowid DESC LIMIT 1`).get(projectId) as { id: string } | undefined;
  if (!activation) throw new Error('The active queue start has no saved provenance.');
  const test = await runIntegrationTest(store, cardId, undefined, policy.hash, activation.id);
  if (test.state !== 'passed' || !test.current)
    throw new Error(`npm run ${test.scriptName} endete mit ${test.state}${test.current ? '' : ' oder veraltetem Git-Stand'}.`);
}
const CONNECTION_PAUSE_PREFIX = 'Gerät meldete offline.';
const IDLE_RECONNECT_PAUSE_REASON = `${CONNECTION_PAUSE_PREFIX} Die ruhende Queue kann nach Rückkehr innerhalb ihrer Frist ohne erneut gesendeten Auftrag fortfahren.`;

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
  private readonly postChecks = new Set<string>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly deadlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly store: StudioStore, private readonly workflows: WorkflowEngine,
    private readonly deviceOnline: () => boolean = () => true,
    private readonly postCheck: typeof testCompletedQueueCard = testCompletedQueueCard) {}

  dispose(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const timer of this.deadlineTimers.values()) clearTimeout(timer);
    this.deadlineTimers.clear();
  }

  cancelProjectRetry(projectId: string): void { this.clearLaunchRetry(projectId); }

  setState(input: { projectId: string; state: QueueState; templateWorkflowId?: string; runUntil?: string | null }): ProjectQueue {
    const current = this.store.projectQueue(input.projectId);
    const templateWorkflowId = input.templateWorkflowId ?? current.templateWorkflowId;
    if (input.state === 'running') {
      const runUntil = input.runUntil === undefined ? current.runUntil ?? null : input.runUntil;
      if (runUntil !== null) {
        const remaining = typeof runUntil === 'string' ? Date.parse(runUntil) - Date.now() : NaN;
        if (!Number.isFinite(remaining) || remaining < 1_000 || remaining > 24 * 60 * 60 * 1_000) {
          throw new Error('Queue-Endzeit muss zwischen einer Sekunde und 24 Stunden in der Zukunft liegen.');
        }
      }
      assertProjectCanStart(this.store, input.projectId);
      if (!this.deviceOnline()) throw new Error('Gerät meldet offline. Warteschlange nach Netzprüfung bewusst fortsetzen.');
      if (!templateWorkflowId) throw new Error('Zuerst eine Workflow-Route als Vorlage wählen.');
      this.store.queueCandidates(input.projectId, 1); // Validate To Do before persisting a running queue.
      const template = this.store.workflow(templateWorkflowId);
      if (template.projectId !== input.projectId) throw new Error('Workflow-Vorlage gehört zu einem anderen Projekt.');
      if (current.activeWorkflowId) {
        const active = this.store.workflow(current.activeWorkflowId);
        const canDefer = current.continueBlocked === true && active.state === 'paused'
          && ['approval', 'manual', 'review', 'wireframe'].includes(active.pauseReason ?? '')
          && !this.store.activeSessionForProject(input.projectId);
        if (active.state !== 'done' && active.state !== 'running' && !canDefer) {
          throw new Error(`${pauseMessage(active)} Die Queue setzt diesen Schritt nicht selbst erneut in Gang.`);
        }
        if (active.state === 'done' && active.currentStep < active.steps.length) throw new Error('Aktiver Workflow wurde vorzeitig als erledigt markiert; bitte prüfen.');
      }
      this.store.saveProjectQueue({ projectId: input.projectId, state: 'running', templateWorkflowId, activeWorkflowId: current.activeWorkflowId, pauseReason: null, runUntil });
      this.scheduleDeadline(input.projectId);
      this.pump(input.projectId);
      return this.store.projectQueue(input.projectId);
    }
    if (input.state !== 'paused' && input.state !== 'off') throw new Error('Ungültiger Warteschlangen-Status.');
    this.clearLaunchRetry(input.projectId);
    this.clearDeadline(input.projectId);
    this.store.saveProjectQueue({ projectId: input.projectId, state: input.state, templateWorkflowId, activeWorkflowId: current.activeWorkflowId,
      pauseReason: input.state === 'paused' ? 'Vom Nutzer pausiert; aktiven Workflow vor Fortsetzung prüfen.' : null, runUntil: input.state === 'off' ? null : undefined });
    if (current.activeWorkflowId) {
      const active = this.store.workflow(current.activeWorkflowId);
      if (active.state === 'running') this.workflows.setState({ id: active.id, state: 'paused' });
    }
    return this.store.projectQueue(input.projectId);
  }

  onSessionFinished(session: Session): void {
    const current = this.store.projectQueue(session.projectId);
    const linked = this.store.workflowForSession(session.id);
    if (current.state === 'running' && current.autoTest && linked && current.activeWorkflowId === linked.id
      && this.store.workflow(linked.id).state === 'done' && !this.postChecks.has(session.projectId)) {
      this.postChecks.add(session.projectId);
      void this.postCheck(this.store, session.projectId, linked.id, linked.cardId).then(
        () => { this.postChecks.delete(session.projectId); this.pump(session.projectId); },
        (error: unknown) => {
          this.postChecks.delete(session.projectId);
          if (this.store.projectQueue(session.projectId).state === 'running')
            this.pause(session.projectId, `Automatischer Kartentest angehalten: ${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}. Test- und Git-Stand prüfen; Queue bewusst fortsetzen.`);
        },
      );
      return;
    }
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
    this.clearDeadline(projectId);
    const current = this.store.projectQueue(projectId);
    const idleAutoResume = current.autoResumeIdle === true && !current.activeWorkflowId && !this.store.activeSessionForProject(projectId);
    this.store.saveProjectQueue({ projectId, state: 'paused', templateWorkflowId: current.templateWorkflowId, activeWorkflowId: current.activeWorkflowId,
      pauseReason: idleAutoResume
        ? IDLE_RECONNECT_PAUSE_REASON
        : `${CONNECTION_PAUSE_PREFIX} Lauf und mögliche Änderungen prüfen; nach Rückkehr nur bewusst fortsetzen.` });
  }

  /** Only an idle, explicitly opted-in queue can continue after a device-online transition. */
  resumeIdleAfterReconnect(): void {
    if (!this.deviceOnline()) return;
    const rows = this.store.db.prepare(`SELECT project_id FROM project_queues
      WHERE state = 'paused' AND auto_resume_idle = 1 AND active_workflow_id IS NULL
        AND pause_reason = ?`).all(IDLE_RECONNECT_PAUSE_REASON) as Array<{ project_id: string }>;
    for (const { project_id: projectId } of rows) {
      const current = this.store.projectQueue(projectId);
      if (this.store.activeSessionForProject(projectId) || projectPauseRequested(this.store, projectId)) continue;
      if (current.runUntil && Date.parse(current.runUntil) - Date.now() < 1_000) {
        this.store.saveProjectQueue({ projectId, state: 'paused', templateWorkflowId: current.templateWorkflowId,
          activeWorkflowId: null, pauseReason: 'Queue-Endzeit während der Netzunterbrechung erreicht. Ergebnisse prüfen und bewusst neu starten.' });
        continue;
      }
      try {
        this.setState({ projectId, state: 'running' });
      } catch (error) {
        this.store.saveProjectQueue({ projectId, state: 'paused', templateWorkflowId: current.templateWorkflowId,
          activeWorkflowId: null, pauseReason: `Automatische Wiederaufnahme der ruhenden Queue fehlgeschlagen: ${error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)}. Bitte prüfen und bewusst starten.` });
      }
    }
  }

  private pause(projectId: string, message: string): void {
    this.clearLaunchRetry(projectId);
    this.clearDeadline(projectId);
    const queue = this.store.projectQueue(projectId);
    this.store.saveProjectQueue({ projectId, state: 'paused', templateWorkflowId: queue.templateWorkflowId, activeWorkflowId: queue.activeWorkflowId, pauseReason: message });
  }

  private clearLaunchRetry(projectId: string): void {
    const timer = this.retryTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(projectId);
    this.store.clearQueueLaunchRetry(projectId);
  }

  private clearDeadline(projectId: string): void {
    const timer = this.deadlineTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.deadlineTimers.delete(projectId);
  }

  private deadlineReached(projectId: string): boolean {
    const until = this.store.projectQueue(projectId).runUntil;
    if (!until || Date.parse(until) > Date.now()) return false;
    const activeId = this.store.projectQueue(projectId).activeWorkflowId;
    if (activeId && this.store.workflow(activeId).state === 'running') {
      // Keep the PTY alive, but prevent WorkflowEngine.onSessionFinished from launching its next step.
      this.store.setWorkflowState(activeId, 'paused');
    }
    this.pause(projectId, `Queue-Endzeit ${new Date(until).toLocaleString('de-DE')} erreicht. Ein bereits laufender Agent darf seinen Schritt beenden; es starten keine weiteren Schritte oder Karten. Danach Ergebnis prüfen, Workflow und Queue ausdrücklich fortsetzen.`);
    return true;
  }

  private scheduleDeadline(projectId: string): void {
    this.clearDeadline(projectId);
    const until = this.store.projectQueue(projectId).runUntil;
    if (!until) return;
    this.deadlineTimers.set(projectId, setTimeout(() => {
      this.deadlineTimers.delete(projectId);
      if (this.store.projectQueue(projectId).state === 'running') this.deadlineReached(projectId);
    }, Math.max(0, Date.parse(until) - Date.now())));
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
    if (this.pumping.has(projectId) || this.postChecks.has(projectId) || this.store.projectQueue(projectId).state !== 'running') return;
    if (this.deadlineReached(projectId)) return;
    if (projectPauseRequested(this.store, projectId)) {
      this.pause(projectId, 'Projektweite sichere Pause angefordert. Queue nach Prüfung bewusst fortsetzen.');
      return;
    }
    if (!this.deviceOnline()) { this.pauseForConnectionLoss(projectId); return; }
    this.pumping.add(projectId);
    try {
      for (let pass = 0; pass < 50; pass += 1) {
        if (this.deadlineReached(projectId)) return;
        if (!this.deviceOnline()) { this.pauseForConnectionLoss(projectId); return; }
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
          if (active.state === 'paused' || active.state === 'draft') {
            if (active.state === 'paused' && queue.continueBlocked === true
              && ['approval', 'manual', 'review', 'wireframe'].includes(active.pauseReason ?? '')
              && !this.store.activeSessionForProject(projectId)) {
              this.store.skipBlockedQueueCard({ projectId, workflowId: active.id });
              continue;
            }
            this.pause(projectId, pauseMessage(active)); return;
          }
          if (active.currentStep < active.steps.length) { this.pause(projectId, 'Aktiver Workflow wurde vorzeitig als erledigt markiert; bitte prüfen.'); return; }
          if (queue.autoTest) {
            const approved = this.store.db.prepare('SELECT auto_test_script_hash AS hash FROM project_queues WHERE project_id = ?')
              .get(projectId) as { hash: string | null } | undefined;
            const cardId = active.cardIds[0];
            const test = cardId ? integrationEvidence(this.store, cardId).test : null;
            if (!approved?.hash || test?.state !== 'passed' || !test.current || test.scriptHash !== approved.hash
              || !queueTestMatchesActiveStart(this.store, projectId, test)) {
              this.pause(projectId, 'Automatischer npm-Test für die abgeschlossene Karte fehlt, ist fehlgeschlagen oder passt nicht mehr zum freigegebenen Skript- und Git-Stand. Karte und Testbeleg prüfen; danach Test erneut ausführen oder die Einstellung bewusst ausschalten.');
              return;
            }
          }
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
        if (started.state === 'paused') {
          if (queue.continueBlocked === true && ['approval', 'manual', 'review', 'wireframe'].includes(started.pauseReason ?? '')
            && !this.store.activeSessionForProject(projectId)) {
            this.store.skipBlockedQueueCard({ projectId, workflowId: started.id });
            continue;
          }
          this.pause(projectId, pauseMessage(started)); return;
        }
        if (started.state === 'running') return;
        // A route can finish synchronously only when it has no agent work.
      }
      this.pause(projectId, 'Queue hat 50 sofortige Übergänge erreicht. Ergebnisse prüfen und bewusst fortsetzen.');
    } catch (error) {
      this.pause(projectId, `Warteschlange angehalten: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.pumping.delete(projectId);
    }
  }
}
