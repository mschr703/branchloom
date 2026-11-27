import { useEffect, useState } from 'react';
import { Bot, Check, CircleHelp, Plus, Radar, RefreshCw, Terminal } from 'lucide-react';
import type { AgentCapability, AgentCapabilityEvidence, AgentDetection, AgentPreset, ProjectSnapshot } from '../../shared/types';
import type { AgentCardMetadataAudit } from '../../shared/agent-card-metadata';
import { CARD_PRIORITIES } from '../../shared/card-metadata';
import { ApiContractPanel } from './ApiContractPanel';
import type { Mutate } from './shared';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; onOpenBrowserSettings?: () => void }
type Draft = Omit<AgentPreset, 'id'> & { id?: string; argumentsText: string };

const emptyDraft: Draft = { name: '', kind: 'codex', command: '', args: [], argumentsText: '', model: null, enabled: true };
const kindName = (kind: AgentPreset['kind']) => kind === 'codex' ? 'Codex' : kind === 'claude' ? 'Claude Code' : kind === 'gemini' ? 'Gemini CLI' : kind === 'antigravity' ? 'Antigravity CLI' : 'Eigener Agent';
const CAPABILITIES: Array<{ id: AgentCapability; label: string; evidence: string; empty: string }> = [
  { id: 'start', label: 'Start', evidence: 'Lokaler PTY-Prozess gestartet', empty: 'Noch kein Kartenlauf belegt' },
  { id: 'input', label: 'Eingabe', evidence: 'Eingabe an laufendes PTY geschrieben', empty: 'Noch keine manuelle Eingabe belegt' },
  { id: 'stop', label: 'Stopp', evidence: 'Prozessende nach Stopp beobachtet', empty: 'Noch kein beendeter Stopp belegt' },
  { id: 'resume', label: 'Resume', evidence: 'Codex-Resume-Aufruf gestartet', empty: 'Noch kein Resume-Aufruf belegt' },
];

export function AgentCapabilityRows({ agent, evidence }: { agent: AgentPreset; evidence: AgentCapabilityEvidence[] }) {
  return <div className="agent-capability-list" aria-label={`Fähigkeitsbelege für ${agent.name}`}>
    {CAPABILITIES.map(({ id, label, evidence: proven, empty }) => {
      const item = evidence.find((entry) => entry.agentId === agent.id && entry.capability === id);
      const unsupported = id === 'resume' && agent.kind !== 'codex';
      return <div className="agent-capability-row" key={id}>
        <strong>{label}</strong>
        <span>{unsupported ? 'Für diesen Adapter derzeit nicht implementiert' : item ? proven : empty}</span>
        <small>{unsupported ? '—' : item ? <time dateTime={item.observedAt} title={`Sitzung ${item.sessionId}`}>{new Date(item.observedAt).toLocaleString('de-DE')}</time> : 'Offen'}</small>
      </div>;
    })}
  </div>;
}

export function diagnosticHint(item: AgentDetection): string {
  switch (item.status) {
    case 'missing': return `„${item.command}“ wurde nicht gefunden. CLI installieren oder den Programmpfad im Agentenprofil korrigieren; danach erneut prüfen.`;
    case 'timeout': return `Die lokale Versionsprüfung wurde nach ${item.kind === 'antigravity' ? '20' : '8'} Sekunden beendet. Prüfe die CLI im Terminal und starte die Erkennung erneut.`;
    case 'error': return 'Die lokale Versionsprüfung schlug fehl. Prüfe die CLI im Terminal und starte die Erkennung erneut.';
    case 'found': return 'Programm gefunden. Eigene CLIs werden aus Sicherheitsgründen erst beim bewussten Kartenstart ausgeführt.';
    case 'ready': return 'CLI-Version geprüft. Die Anmeldung und ein Modellaufruf wurden nicht geprüft.';
  }
}

export function DiagnosticStatus({ item }: { item: AgentDetection }) {
  const label = item.status === 'ready' ? 'CLI geprüft' : item.status === 'found' ? 'CLI gefunden' : item.status === 'missing' ? 'CLI fehlt' : item.status === 'timeout' ? 'Zeitlimit' : 'Prüfung fehlgeschlagen';
  return <span className={item.available ? 'available-badge' : 'unavailable-badge'}>{item.available && <Check size={12} />}{label}</span>;
}

export function agentProfileSummary(agent: AgentPreset, check?: AgentDetection): string {
  if (!agent.enabled) return 'Im Projekt deaktiviert';
  if (!check) return 'Im Projekt aktiviert · CLI-Prüfung läuft';
  if (!check.available) return 'Im Projekt aktiviert · aktuell nicht startbereit';
  return 'Im Projekt aktiviert · Anmeldung und Modellzugang ungeprüft';
}

export function AgentView({ snapshot, mutate, onOpenBrowserSettings }: Props) {
  const [detections, setDetections] = useState<AgentDetection[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [evidence, setEvidence] = useState<AgentCapabilityEvidence[]>([]);
  const [evidenceError, setEvidenceError] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState(snapshot.agents[0]?.id ?? '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [metadataEnabled, setMetadataEnabled] = useState<boolean | null>(null);
  const [metadataAvailable, setMetadataAvailable] = useState<boolean | null>(null);
  const [metadataAudit, setMetadataAudit] = useState<AgentCardMetadataAudit[]>([]);
  const [metadataError, setMetadataError] = useState('');
  const [metadataPending, setMetadataPending] = useState(false);

  useEffect(() => {
    let active = true;
    setMetadataEnabled(null);
    Promise.all([window.studio.agentCardMetadataEnabled(snapshot.project.id), window.studio.agentCardMetadataAvailable(), window.studio.agentCardMetadataAudit(snapshot.project.id)])
      .then(([enabled, available, audit]) => { if (active) { setMetadataEnabled(enabled); setMetadataAvailable(available); setMetadataAudit(audit); setMetadataError(''); } })
      .catch((reason: unknown) => { if (active) setMetadataError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [snapshot.project.id]);
  useEffect(() => {
    let active = true;
    window.studio.agentCardMetadataAudit(snapshot.project.id)
      .then((audit) => { if (active) setMetadataAudit(audit); })
      .catch(() => undefined);
    window.studio.agentCardMetadataAvailable()
      .then((available) => { if (active) setMetadataAvailable(available); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [snapshot.project.id, snapshot.cards]);

  async function setMetadataPermission(enabled: boolean) {
    setMetadataPending(true); setMetadataError('');
    try {
      const saved = await mutate(() => window.studio.setAgentCardMetadataEnabled({ projectId: snapshot.project.id, enabled }));
      if (saved !== null) setMetadataEnabled(saved);
    } catch (reason) { setMetadataError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setMetadataPending(false); }
  }

  async function refreshEvidence() {
    try { setEvidence(await window.studio.agentCapabilityEvidence()); setEvidenceError(''); }
    catch (reason) { setEvidenceError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function detect() {
    setDetecting(true); setDetectError('');
    void refreshEvidence();
    try { setDetections(await window.studio.detectAgents()); }
    catch (reason) { setDetectError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDetecting(false); }
  }
  useEffect(() => { void detect(); }, []);
  useEffect(() => { if (!snapshot.agents.some((agent) => agent.id === selectedAgentId)) setSelectedAgentId(snapshot.agents[0]?.id ?? ''); }, [snapshot.agents, selectedAgentId]);

  function edit(agent: AgentPreset) { setDraft({ ...agent, argumentsText: agent.args.join('\n') }); }
  function fromDetection(detection: AgentDetection) {
    setDraft({ ...emptyDraft, name: kindName(detection.kind), kind: detection.kind, command: detection.command });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const { argumentsText, ...values } = draft;
    const saved = await mutate(() => window.studio.saveAgent({ ...values, name: values.name.trim(), command: values.command.trim(), args: argumentsText.split('\n').map((line) => line.trim()).filter(Boolean), model: values.model?.trim() || null }));
    if (saved) { setDraft(null); void detect(); }
  }

  return <div className="standard-page">
    <div className="view-header"><div><h2>Agenten verbinden</h2><p>Installierte CLIs erkennen, Startargumente festlegen und auf Karten einsetzen.</p></div><button className="primary-button" type="button" onClick={() => setDraft({ ...emptyDraft })}><Plus size={17} /> Agent anlegen</button></div>
    <div className="agent-grid">
      <section className="panel">
        <div className="panel-heading"><div><Radar size={18} /><h3>Erkannte CLIs</h3></div><button className="icon-button" type="button" title="Erkennung erneut starten" aria-label="Erkennung erneut starten" disabled={detecting} onClick={() => void detect()}><RefreshCw size={16} className={detecting ? 'spin' : ''} /></button></div>
        <p className="panel-subtitle">Branchloom prüft die lokalen Programmdateien und bei bekannten CLIs die Version. Anmeldung und Modellzugang werden dabei nicht geprüft.</p>
        {detectError ? <p className="inline-error" role="alert">{detectError}</p> : null}
        <div className="detected-list">{detecting && detections.length === 0 ? <p className="list-empty">Suche nach CLIs…</p> : detections.filter((item) => !item.profileId).map((item) => <div className="detected-item" key={item.kind}><div className="detected-icon"><Terminal size={18} /></div><div><strong>{kindName(item.kind)}</strong><span>{item.version || item.command}</span><small className="agent-diagnostic-hint">{diagnosticHint(item)}</small></div><DiagnosticStatus item={item} />{item.available ? <button className="text-button" type="button" onClick={() => fromDetection(item)}>Einrichten</button> : null}</div>)}</div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><Bot size={18} /><h3>Gespeicherte Agenten</h3></div><span className="count-pill">{snapshot.agents.length}</span></div>
        <p className="panel-subtitle">Ein gespeichertes Profil kann im Projekt aktiviert sein, auch wenn seine CLI auf diesem Gerät fehlt. Die Erkennung prüft weder Anmeldung noch Modellzugang.</p>
        {snapshot.agents.length ? <div className="preset-list">{snapshot.agents.map((agent) => { const check = detections.find((item) => item.profileId === agent.id); return <button className="preset-item" type="button" key={agent.id} onClick={() => edit(agent)}><span className="preset-avatar"><Bot size={19} /></span><span><strong>{agent.name}</strong><small>{agent.kind} · {agent.command}{agent.model ? ` · ${agent.model}` : ''}</small><small className="agent-diagnostic-hint">{agentProfileSummary(agent, check)}</small>{check ? <small className="agent-diagnostic-hint">{diagnosticHint(check)}</small> : null}</span>{check ? <DiagnosticStatus item={check} /> : null}</button>; })}</div> : <div className="agent-empty"><CircleHelp size={22} /><p>Noch kein Agent gespeichert. Nutze einen erkannten CLI-Eintrag oder lege einen eigenen an.</p></div>}
      </section>
    </div>
    <section className="agent-metadata-policy" aria-label="Agentenrechte für Kartenmetadaten">
      <div className="agent-metadata-policy-head"><div><h3>Priorität und Labels durch Agenten</h3><p>Nur für dieses Projekt. Ein laufender Kartenagent erhält bei erlaubter Einstellung einen lokalen, auf seine Karte begrenzten Schreibweg. Änderungen bleiben mit Sitzung und Begründung nachvollziehbar.</p></div><label className="agent-metadata-toggle"><input type="checkbox" checked={metadataEnabled === true} disabled={metadataEnabled === null || metadataPending} onChange={(event) => void setMetadataPermission(event.target.checked)} /><span>Agenten dürfen ändern</span></label></div>
      {metadataError ? <p className="inline-error" role="alert">{metadataError}</p> : null}
      {metadataAvailable === false ? <p className="agent-metadata-unavailable" role="status">Der lokale Metadaten-Dienst ist gerade nicht verfügbar. Die Projektfreigabe bleibt gespeichert; Agenten können damit erst nach einem erfolgreichen Neustart Kartenwerte ändern.</p> : null}
      {metadataAudit.length > 0 ? <details className="agent-metadata-history"><summary>Agentenänderungen · {metadataAudit.length}</summary><ol>{metadataAudit.slice(0, 10).map((item) => <li key={item.id}><time dateTime={item.changedAt}>{new Date(item.changedAt).toLocaleString('de-DE')}</time><strong>{item.agentName}</strong><span>{snapshot.cards.find((card) => card.id === item.cardId)?.title ?? 'Karte'}</span><small>Priorität: {CARD_PRIORITIES.find((entry) => entry.value === item.beforePriority)?.label} → {CARD_PRIORITIES.find((entry) => entry.value === item.afterPriority)?.label}; Labels: {item.beforeLabels.join(', ') || 'keine'} → {item.afterLabels.join(', ') || 'keine'}</small><p>{item.reason}</p><small>Sitzung {item.sessionId}</small></li>)}</ol></details> : <p className="agent-metadata-empty">Noch keine Agentenänderungen an Priorität oder Labels.</p>}
    </section>
    <p className="panel-subtitle">Lesende lokale Browserprüfungen werden pro Projekt unter Einstellungen freigegeben. <button className="text-button" type="button" onClick={onOpenBrowserSettings} disabled={!onOpenBrowserSettings}>Browser-Einstellungen öffnen</button></p>
    <ApiContractPanel projectId={snapshot.project.id} cards={snapshot.cards} />
    <section className="panel agent-capability-panel">
      <div className="panel-heading"><div><Radar size={18} /><h3>Fähigkeitsbelege</h3></div></div>
      <p className="panel-subtitle">Aus echten lokalen Kartensitzungen. Ein PTY-Start oder gesendete Eingabe beweist keine Anmeldung, Modellantwort oder erfolgreiche Gesprächsfortsetzung. Alte Läufe ohne Aufzeichnung bleiben offen.</p>
      {evidenceError ? <p className="inline-error" role="alert">{evidenceError}</p> : null}
      {snapshot.agents.length ? <><label className="agent-capability-select">Agentenprofil<select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>{snapshot.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        {snapshot.agents.filter((agent) => agent.id === selectedAgentId).map((agent) => <AgentCapabilityRows key={agent.id} agent={agent} evidence={evidence} />)}</> : <p className="list-empty">Erst ein Agentenprofil anlegen.</p>}
    </section>
    <div className="info-strip"><CircleHelp size={18} /><p>CLI-Agenten können Dateien im Projektordner ändern und eigene Netzwerkzugriffe durchführen. Verwende nur Programme und Modelle, denen du vertraust.</p></div>
    {draft ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}><form className="dialog" onSubmit={(event) => void save(event)}><div className="dialog-heading"><div><small>AGENTENPROFIL</small><h2>{draft.id ? 'Agent bearbeiten' : 'Agent anlegen'}</h2></div><button className="icon-button" type="button" onClick={() => setDraft(null)} aria-label="Schließen">×</button></div><label>Name<input autoFocus required maxLength={80} value={draft.name} onChange={(event) => setDraft((old) => old && ({ ...old, name: event.target.value }))} placeholder="Codex" /></label><label>Typ<select value={draft.kind} onChange={(event) => setDraft((old) => old && ({ ...old, kind: event.target.value as AgentPreset['kind'] }))}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="gemini">Gemini CLI</option><option value="antigravity">Antigravity CLI</option><option value="custom">Eigener CLI-Agent</option></select></label><label>Programm<input required value={draft.command} onChange={(event) => setDraft((old) => old && ({ ...old, command: event.target.value }))} placeholder="codex, agy oder C:\\Pfad\\agent.exe" /></label><label>Argumente – eine Zeile pro Argument<textarea rows={4} value={draft.argumentsText} onChange={(event) => setDraft((old) => old && ({ ...old, argumentsText: event.target.value }))} placeholder="--agent&#10;mein-agent" /></label><label>Modell (optional)<input value={draft.model ?? ''} onChange={(event) => setDraft((old) => old && ({ ...old, model: event.target.value }))} placeholder="Modellkennung" /></label><label className="check-option"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((old) => old && ({ ...old, enabled: event.target.checked }))} /> Profil aktivieren</label><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDraft(null)}>Abbrechen</button><button className="primary-button" type="submit">Speichern</button></div></form></div> : null}
  </div>;
}
