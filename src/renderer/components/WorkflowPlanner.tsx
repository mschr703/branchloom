import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ListTree, LoaderCircle } from 'lucide-react';
import type { AgentDetection, ProjectSnapshot, WorkflowAgentSettings, WorkflowProposal } from '../../shared/types';
import type { ReviewedPlan } from '../../shared/plan-review';
import type { Mutate } from './shared';
import { PlanReviewPanel } from './PlanReviewPanel';
import { ReviewRulesPanel } from './ReviewRulesPanel';
import { WorkflowProposalEditor } from './WorkflowProposalEditor';
import { workflowRevisionRequest } from '../workflow-revision';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; openPlan?: { id: string; token: number } | null }
const emptySettings: WorkflowAgentSettings = { agentId: null, model: null, effort: null };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function ProposalPreview({ proposal, snapshot, onAccept, accepting, accepted = false, acceptDisabled = false }: {
  proposal: WorkflowProposal; snapshot: ProjectSnapshot; onAccept: () => void; accepting: boolean; accepted?: boolean; acceptDisabled?: boolean;
}) {
  const route = proposal.columnIds.map((id) => snapshot.columns.find((column) => column.id === id));
  const cited = [...proposal.explanation.matchAll(/\[(card|column):([^\]]+)\]/g)].flatMap((match) => {
    if (match[1] === 'card') {
      const card = snapshot.cards.find((item) => item.id === match[2]);
      return card ? [{ key: `card:${card.id}`, label: `Karte: ${card.title}` }] : [];
    }
    const column = snapshot.columns.find((item) => item.id === match[2]);
    return column ? [{ key: `column:${column.id}`, label: `Spalte: ${column.name}` }] : [];
  });
  return <section className="proposal-preview" aria-label="Workflow-Vorschau">
    <div className="proposal-heading"><div><span className="workflow-kicker"><ListTree size={14} /> VORSCHLAG</span><h3>{proposal.title}</h3></div><span className="state-badge">{accepted ? 'Bereits übernommen' : 'Noch nicht übernommen'}</span></div>
    <p>{proposal.explanation}</p>
    {cited.length ? <div className="workflow-plan-citations"><strong>Verifizierte Board-Verweise</strong><ul>{[...new Map(cited.map((item) => [item.key, item])).values()].map((item) => <li key={item.key}>{item.label}</li>)}</ul></div> : null}
    <div className="proposal-grid"><div><h4>Karten</h4><ol className="proposal-cards">{proposal.cards.map((card, index) => <li key={index}><strong>{card.title}</strong><span>{card.description}</span></li>)}</ol></div><div><h4>Route und Spaltenagenten</h4><div className="proposal-route">{route.map((column, index) => <span key={`${index}-${column?.id ?? 'missing'}`}><span className="route-number">{index + 1}</span><span><strong>{column?.name ?? 'Unbekannte Spalte'}</strong><small>{snapshot.agents.find((agent) => agent.id === column?.agentId)?.name ?? 'Manueller Schritt'} · {column?.autoStart ? 'Automatisch' : 'Freigabe vor Start'}</small></span>{index < route.length - 1 ? <ArrowRight size={13} /> : null}</span>)}</div></div></div>
    <div className="proposal-footer"><span>Beim Übernehmen werden Karten und ein Workflow-Entwurf angelegt. Er startet erst nach deinem Klick auf „Starten“.</span><button className="primary-button" type="button" disabled={accepted || acceptDisabled || accepting || proposal.cards.length === 0 || route.length === 0} onClick={onAccept}>{accepting ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Vorschlag übernehmen</button></div>
  </section>;
}

export function WorkflowPlanner({ snapshot, mutate, openPlan }: Props) {
  const [settings, setSettings] = useState<WorkflowAgentSettings>(emptySettings);
  const [loaded, setLoaded] = useState(false);
  const [detections, setDetections] = useState<AgentDetection[]>([]);
  const [request, setRequest] = useState('');
  const [feedback, setFeedback] = useState('');
  const [proposalDraft, setProposalDraft] = useState<WorkflowProposal | null>(null);
  const [plans, setPlans] = useState<ReviewedPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'plan' | 'revise' | 'edit' | 'accept' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rulesRevision, setRulesRevision] = useState(0);
  const currentProjectId = useRef(snapshot.project.id);
  const handledPlanToken = useRef<number | null>(null);
  const [pendingPlanFocus, setPendingPlanFocus] = useState<{ id: string; token: number } | null>(null);
  const planReviewElement = useRef<HTMLDivElement>(null);
  currentProjectId.current = snapshot.project.id;

  useEffect(() => {
    let active = true;
    setLoaded(false);
    Promise.all([window.studio.workflowAgentSettings(), window.studio.detectAgents().catch(() => [])])
      .then(([saved, available]) => { if (active) { setSettings(saved); setDetections(available); setLoaded(true); } })
      .catch((reason: unknown) => { if (active) { setError(errorMessage(reason)); setLoaded(true); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setPlans([]); setSelectedPlanId(null); setNotice('');
    void window.studio.reviewedPlans(snapshot.project.id).then((items) => {
      if (active) { setPlans(items); setSelectedPlanId(items[0]?.id ?? null); setRequest(items[0]?.request ?? ''); }
    }, (reason) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [snapshot.project.id]);

  useEffect(() => {
    if (!openPlan || handledPlanToken.current === openPlan.token) return;
    const target = plans.find((item) => item.id === openPlan.id);
    if (!target) return;
    handledPlanToken.current = openPlan.token;
    setSelectedPlanId(target.id);
    setRequest(target.request);
    setPendingPlanFocus({ id: target.id, token: openPlan.token });
  }, [openPlan?.id, openPlan?.token, plans]);

  const planDraft = plans.find((item) => item.id === selectedPlanId) ?? null;
  useEffect(() => { setProposalDraft(planDraft ? structuredClone(planDraft.proposal) : null); setFeedback(''); }, [planDraft?.id]);
  useLayoutEffect(() => {
    if (!pendingPlanFocus || planDraft?.id !== pendingPlanFocus.id || !planReviewElement.current) return;
    planReviewElement.current.focus();
    planReviewElement.current.scrollIntoView({ block: 'center' });
    setPendingPlanFocus(null);
  }, [pendingPlanFocus, planDraft?.id]);
  const changedRequest = Boolean(planDraft && request.trim() !== planDraft.request);
  const changedProposal = Boolean(planDraft && proposalDraft && JSON.stringify(proposalDraft) !== JSON.stringify(planDraft.proposal));

  const selected = snapshot.agents.find((agent) => agent.id === settings.agentId);
  const selectedDetection = selected && detections.find((item) => item.kind === selected.kind && item.command === selected.command);
  const missingCli = selected && selectedDetection?.available === false;
  const unsupportedPlanner = selected && selected.kind !== 'codex';

  function changeSettings(next: WorkflowAgentSettings) {
    setSettings(next); setNotice(''); setError('');
  }

  async function save() {
    setBusy('save'); setError(''); setNotice('');
    try {
      const saved = await window.studio.saveWorkflowAgentSettings(settings);
      setSettings(saved); setNotice('Workflow-Agent gespeichert. Diese Einstellung gilt für alle Projekte.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  }

  async function plan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.enabled || unsupportedPlanner || missingCli || !request.trim()) return;
    setBusy('plan'); setError(''); setNotice('');
    const projectId = snapshot.project.id;
    try {
      const saved = await window.studio.saveWorkflowAgentSettings(settings);
      setSettings(saved);
      const result = await window.studio.proposeReviewedWorkflow({ projectId, request: request.trim() });
      if (currentProjectId.current === projectId) {
        const next = await window.studio.reviewedPlans(projectId);
        if (currentProjectId.current === projectId) { setPlans(next); setSelectedPlanId(result.id); }
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  }

  async function accept() {
    if (!planDraft || planDraft.state !== 'open' || changedRequest || changedProposal) return;
    setBusy('accept'); setError(''); setNotice('');
    const created = await mutate(() => window.studio.acceptReviewedPlan({ planId: planDraft.id, fingerprint: planDraft.fingerprint }));
    if (created) {
      const projectId = snapshot.project.id;
      const next = await window.studio.reviewedPlans(projectId);
      if (currentProjectId.current === projectId) { setPlans(next); setNotice('Der Workflow-Entwurf und seine Karten wurden im Board angelegt.'); }
    }
    setBusy(null);
  }

  async function revise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!planDraft || planDraft.state !== 'open' || changedRequest || changedProposal || !selected?.enabled || unsupportedPlanner || missingCli || busy || !feedback.trim()) return;
    setBusy('revise'); setError(''); setNotice('');
    const projectId = snapshot.project.id;
    try {
      const revisedRequest = workflowRevisionRequest(planDraft, feedback);
      await window.studio.saveWorkflowAgentSettings(settings);
      const revised = await window.studio.proposeReviewedWorkflow({ projectId, request: revisedRequest });
      if (currentProjectId.current === projectId) {
        setPlans(await window.studio.reviewedPlans(projectId)); setSelectedPlanId(revised.id); setRequest(revised.request);
        setNotice('Der Agent hat eine neue prüfbare Version vorgeschlagen. Die vorige Version bleibt lesbar.');
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  }

  async function saveEditedProposal() {
    if (!planDraft || !proposalDraft || planDraft.state !== 'open' || changedRequest || !changedProposal || busy) return;
    setBusy('edit'); setError(''); setNotice('');
    try {
      const revised = await window.studio.reviseReviewedPlan({ planId: planDraft.id, fingerprint: planDraft.fingerprint, proposal: proposalDraft });
      if (currentProjectId.current === snapshot.project.id) {
        setPlans(await window.studio.reviewedPlans(snapshot.project.id)); setSelectedPlanId(revised.id); setRequest(revised.request);
        setNotice('Deine Änderungen sind als neue Planversion gespeichert. Es wurden keine Karten angelegt.');
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(null); }
  }

  return <section className="workflow-planner panel" aria-label="Globaler Workflow-Agent">
    <div className="planner-head"><div><h3>Route mit einem Agenten entwerfen</h3><p>Beschreibe das Ziel. Der Planungsagent schlägt Karten und Schritte vor; du prüfst den Entwurf, bevor etwas angelegt wird. Die Agenten der einzelnen Schritte wählst du separat.</p></div></div>
    <div className="planner-settings">
      <label>Agent<select value={settings.agentId ?? ''} disabled={!loaded || busy !== null} onChange={(event) => changeSettings({ ...settings, agentId: event.target.value || null })}><option value="">Agent auswählen</option>{snapshot.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.enabled ? '' : ' (deaktiviert)'}</option>)}</select></label>
      <label>Modell<input value={settings.model ?? ''} disabled={!loaded || busy !== null} onChange={(event) => changeSettings({ ...settings, model: event.target.value || null })} placeholder={selected?.model || 'Standard des Agenten'} /></label>
      <label>Effort<select value={settings.effort ?? ''} disabled={!loaded || busy !== null} onChange={(event) => changeSettings({ ...settings, effort: event.target.value ? event.target.value as WorkflowAgentSettings['effort'] : null })}><option value="">CLI-Standard</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <button className="secondary-button" type="button" disabled={!loaded || busy !== null} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle className="spin" size={14} /> : null} Einstellungen speichern</button>
    </div>
    {snapshot.agents.length === 0 ? <p className="planner-hint">Noch kein CLI-Agent eingerichtet. Lege im Bereich „Agenten“ zuerst ein Profil an.</p> : null}
    {selected && !selected.enabled ? <p className="inline-error" role="alert">Dieses Agentenprofil ist deaktiviert. Aktiviere es im Bereich „Agenten“.</p> : null}
    {unsupportedPlanner ? <p className="inline-error" role="alert">Die sichere, schreibgeschützte Workflow-Planung unterstützt derzeit nur Codex CLI. Andere CLI-Agenten können als Spaltenagenten arbeiten.</p> : null}
    {missingCli ? <p className="inline-error" role="alert">Die CLI für „{selected.name}“ ist auf diesem Gerät nicht installiert oder nicht erreichbar. Prüfe die Installation im Bereich „Agenten“.</p> : null}
    <form className="planner-request" onSubmit={(event) => void plan(event)}><label htmlFor="workflow-request">Was soll erledigt werden?</label><textarea id="workflow-request" rows={4} maxLength={8000} value={request} disabled={busy !== null} onChange={(event) => { setRequest(event.target.value); setNotice(''); }} placeholder="Zum Beispiel: Plane die Umsetzung einer lokalen Suche mit Tests und Review." /><div className="planner-request-actions"><details className="workflow-context-disclosure"><summary>Welche Projektdaten sieht der Agent?</summary><p>Beim Planen erhält Codex dein Ziel, den Projektnamen, Spalten mit Agent und Autostart-Status, die Titel und IDs der ersten 30 aktiven Board-Karten, das reguläre Projekt-README (maximal 12 KB) und aktivierte Projektregeln aus Reviews (maximal 10 Regeln / 4 KB). Andere Projektdateien werden nicht mitgegeben. Der Vorschlag legt noch nichts an.</p></details><button className="primary-button" type="submit" disabled={!loaded || busy !== null || !selected?.enabled || Boolean(unsupportedPlanner) || Boolean(missingCli) || !request.trim()}>{busy === 'plan' ? <LoaderCircle className="spin" size={15} /> : <ListTree size={15} />} Ablauf vorschlagen</button></div></form>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="planner-notice" role="status">{notice}</p> : null}
    {plans.length ? <label className="field-label">Gespeicherte Planvorschläge<select value={selectedPlanId ?? ''} onChange={(event) => { const next = plans.find((item) => item.id === event.target.value); setSelectedPlanId(event.target.value); if (next) setRequest(next.request); }}>{plans.map((item) => <option key={item.id} value={item.id}>{item.proposal.title} · {item.state === 'open' ? 'offen' : item.state === 'accepted' ? 'übernommen' : 'älter'}</option>)}</select></label> : null}
    {changedRequest ? <p className="inline-note" role="status">Der Auftrag wurde seit diesem Vorschlag bearbeitet. Plane erneut, bevor du ihn übernimmst.</p> : null}
    {planDraft ? <div id="workflow-plan-review" ref={planReviewElement} tabIndex={-1} role="region" aria-label={`Gespeicherter Planvorschlag: ${planDraft.proposal.title}`}>
      <ProposalPreview proposal={planDraft.proposal} snapshot={snapshot} onAccept={() => void accept()} accepting={busy === 'accept'} accepted={planDraft.state === 'accepted'} acceptDisabled={changedRequest || changedProposal || planDraft.state !== 'open'} />
      {proposalDraft && planDraft.state === 'open' ? <WorkflowProposalEditor proposal={proposalDraft} columns={snapshot.columns} changed={changedProposal} saving={busy === 'edit'} disabled={busy !== null || changedRequest} onChange={setProposalDraft} onSave={() => void saveEditedProposal()} onReset={() => setProposalDraft(structuredClone(planDraft.proposal))} /> : null}
      {planDraft.state === 'open' ? <form className="workflow-revision-chat" aria-label="Plan mit Agenten weiterdenken" onSubmit={(event) => void revise(event)}>
        <div><strong>Mit dem Planungsagenten weiterdenken</strong><p>Stelle eine Rückfrage oder gib eine Richtung vor. Der Agent erstellt eine neue Version; bisherige Planstellen und Kommentare bleiben lesbar.</p></div>
        <label htmlFor="workflow-revision-feedback">Deine Nachricht<textarea id="workflow-revision-feedback" rows={3} maxLength={2000} value={feedback} disabled={busy !== null} onChange={(event) => setFeedback(event.target.value)} placeholder="Zum Beispiel: Welche Karte sollten wir vor dem UI-Schritt erledigen? Bitte den Ablauf entsprechend ändern." /></label>
        <button className="secondary-button" type="submit" disabled={busy !== null || !selected?.enabled || Boolean(unsupportedPlanner) || Boolean(missingCli) || !feedback.trim() || changedRequest || changedProposal}>{busy === 'revise' ? <LoaderCircle className="spin" size={15} /> : null} An Agenten senden</button>
      </form> : null}
      <PlanReviewPanel plan={planDraft} onRuleSaved={() => setRulesRevision((value) => value + 1)} />
    </div> : null}
    <ReviewRulesPanel projectId={snapshot.project.id} refreshKey={rulesRevision} />
  </section>;
}
