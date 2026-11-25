import { useEffect, useMemo, useState } from 'react';
import type { ProjectSnapshot } from '../../shared/types';
import type { UsageSessionPage } from '../../shared/usage';
import { formatUsageDuration, projectUsage, usageStart, type CardUsage, type ProjectUsage, type UsagePeriod } from '../usage-data';
import '../usage.css';

interface Props { snapshot: ProjectSnapshot; now: number; onShowAgent: (name: string) => void; onOpenWorkflow: (id: string) => void; onOpenCard: (id: string) => void }

function cardDetails(card: CardUsage): string {
  const duration = card.unknownDurationCount === card.runs ? 'Laufzeit nicht belegt' : formatUsageDuration(card.durationMs);
  const missing = card.unknownDurationCount && card.unknownDurationCount < card.runs
    ? ` · ${card.unknownDurationCount} ohne Zeitbeleg` : '';
  return `${card.runs} ${card.runs === 1 ? 'Lauf' : 'Läufe'} · ${card.agents} ${card.agents === 1 ? 'Agent' : 'Agenten'} · ${duration}${missing}${card.failed ? ` · ${card.failed} fehlgeschlagen` : ''}${card.active ? ` · ${card.active} aktiv` : ''}`;
}

export function UsageSourceBreakdown({ usage, availableWorkflowIds, onOpenWorkflow }: {
  usage: ProjectUsage; availableWorkflowIds: ReadonlySet<string>; onOpenWorkflow: (id: string) => void;
}) {
  return <>
    <div className="usage-origin"><div className="usage-section-head"><h3>Startwege</h3><span>gespeicherte Zuordnung</span></div>
      <dl>{([
        ['queue', 'Projektwarteschlange'], ['workflow', 'Workflow'], ['direct', 'Ohne Workflow'], ['unknown', 'Historisch ungeklärt'],
      ] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{usage.origins[key]}</dd></div>)}</dl>
    </div>
    <div className="usage-workflows"><div className="usage-section-head"><h3>Workflows</h3><span>{usage.workflows.length} mit belegtem Lauf</span></div>
      {usage.workflows.length ? <div className="usage-workflow-list">{usage.workflows.slice(0, 6).map((workflow) =>
        availableWorkflowIds.has(workflow.id) ? <button type="button" key={workflow.id} onClick={() => onOpenWorkflow(workflow.id)}>
          <span><strong>{workflow.name}</strong><small>{workflow.origin === 'queue' ? 'Projektwarteschlange' : 'Workflow'} · {formatUsageDuration(workflow.durationMs)}{workflow.failed ? ` · ${workflow.failed} fehlgeschlagen` : ''}</small></span>
          <span>{workflow.runs} {workflow.runs === 1 ? 'Lauf' : 'Läufe'}</span>
        </button> : <div className="usage-workflow-missing" key={workflow.id}>
          <span><strong>{workflow.name}</strong><small>Workflow entfernt · {formatUsageDuration(workflow.durationMs)}</small></span>
          <span>{workflow.runs} {workflow.runs === 1 ? 'Lauf' : 'Läufe'}</span>
        </div>)}</div> : <p className="usage-empty">Noch kein verknüpfter Workflow-Lauf in diesem Zeitraum.</p>}
      {usage.workflows.length > 6 ? <p className="usage-more">{usage.workflows.length - 6} weitere Workflows im Zeitraum.</p> : null}
    </div>
  </>;
}

export function UsagePanel({ snapshot, now, onShowAgent, onOpenWorkflow, onOpenCard }: Props) {
  const [period, setPeriod] = useState<UsagePeriod>(7);
  const [visibleCards, setVisibleCards] = useState(8);
  const [page, setPage] = useState<UsageSessionPage | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const currentDay = new Date(now).toDateString();
  const sessionRevision = snapshot.sessions.map((item) => `${item.id}:${item.state}:${item.endedAt ?? ''}`).join('|');
  useEffect(() => {
    let active = true;
    setPage(null);
    setError(false);
    void window.studio.usageSessions({ projectId: snapshot.project.id, since: usageStart(Date.now(), period).toISOString() })
      .then((result) => { if (active) setPage(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [snapshot.project.id, period, currentDay, sessionRevision, retry]);
  const usage = useMemo(() => page ? projectUsage(page, snapshot.agents, now, period) : null, [page, snapshot.agents, now, period]);
  const availableCardIds = useMemo(() => new Set(snapshot.cards.map((card) => card.id)), [snapshot.cards]);
  const maxRuns = Math.max(1, ...(usage?.days.map((day) => day.runs) ?? []));
  return <section className="usage-panel" aria-label="Projektnutzung">
    <div className="usage-toolbar"><p>Gespeicherte lokale Agentenläufe dieses Projekts</p><div className="usage-period" role="group" aria-label="Zeitraum">
      <button type="button" aria-pressed={period === 7} onClick={() => { setPeriod(7); setVisibleCards(8); }}>7 Tage</button>
      <button type="button" aria-pressed={period === 30} onClick={() => { setPeriod(30); setVisibleCards(8); }}>30 Tage</button>
    </div></div>
    {error ? <div className="usage-load-state" role="alert">Nutzungsdaten konnten nicht geladen werden. <button type="button" className="secondary-button small" onClick={() => setRetry((value) => value + 1)}>Erneut laden</button></div>
      : !usage ? <p className="usage-load-state" role="status">Nutzungsdaten werden geladen…</p> : <>
    {usage.truncated ? <p className="usage-limit" role="status">Mehr als 10.000 Läufe im Zeitraum: Die folgenden Zahlen zeigen nur die neuesten 10.000.</p> : null}
    <div className="usage-numbers" aria-label="Nutzungszahlen">
      <div className="usage-primary"><strong>{usage.runs}</strong><span>Agentenläufe gestartet{usage.truncated ? ' (Teilmenge)' : ''}</span></div>
      <div><strong>{usage.agents.length}</strong><span>Agenten genutzt</span></div>
      <div><strong>{usage.active}</strong><span>davon aktiv</span></div>
      <div><strong>{usage.failed}</strong><span>fehlgeschlagen</span></div>
      <div><strong>{formatUsageDuration(usage.knownDurationMs)}</strong><span>summierte Laufzeit{usage.unknownDurationCount ? ` · ${usage.unknownDurationCount} ohne Zeitbeleg` : ''}</span></div>
    </div>
    <p className="usage-telemetry"><strong>Token und Kosten</strong><span>Kein verifizierter Wert verfügbar. Branchloom liest derzeit keine Abrechnungsdaten der CLI-Anbieter; Terminaltext wird nicht als Verbrauch gezählt.</span></p>
    <div className="usage-analysis">
      <section className="usage-history" aria-label="Läufe nach Tag"><div className="usage-section-head"><h3>Verlauf</h3><span>Starts pro Tag</span></div>
        <div className="usage-bars" role="img" aria-label={`${usage.runs} Agentenläufe im gewählten Zeitraum`}>
          {usage.days.map((day) => <div className="usage-day" key={day.key} title={`${day.label}: ${day.runs} Läufe`} aria-label={`${day.label}: ${day.runs} Läufe`}>
            <span className="usage-bar-track"><span style={{ height: `${day.runs ? Math.max(8, day.runs / maxRuns * 100) : 0}%` }} /></span>
            {period === 7 || Number(day.key.slice(-2)) % 5 === 0 ? <small>{day.label}</small> : <small aria-hidden="true">·</small>}
          </div>)}
        </div>
      </section>
      <section className="usage-agents" aria-label="Nutzung nach Agent"><div className="usage-section-head"><h3>Agenten</h3><span>{usage.agents.length} im Zeitraum</span></div>
        {usage.agents.length ? <div className="usage-agent-list">{usage.agents.map((agent) => <button type="button" className="usage-agent" key={agent.id} onClick={() => onShowAgent(agent.name)} aria-label={`${agent.name}: ${agent.runs} Läufe in Aktivität anzeigen`}>
          <span className="usage-agent-name">{agent.name}</span><span className="usage-agent-meter"><span style={{ width: `${agent.runs / usage.runs * 100}%` }} /></span>
          <span className="usage-agent-count">{agent.runs} {agent.runs === 1 ? 'Lauf' : 'Läufe'}</span>
          <small>{formatUsageDuration(agent.durationMs)}{agent.failed ? ` · ${agent.failed} fehlgeschlagen` : ''}{agent.active ? ` · ${agent.active} aktiv` : ''}</small>
        </button>)}</div> : <p className="usage-empty">In diesem Zeitraum wurde kein Agentenlauf gestartet.</p>}
        <UsageSourceBreakdown usage={usage} availableWorkflowIds={new Set(snapshot.workflows.map((workflow) => workflow.id))} onOpenWorkflow={onOpenWorkflow} />
      </section>
    </div>
    <section className="usage-cards" aria-label="Nutzung nach Aufgabe">
      <div className="usage-section-head"><h3>Aufgaben</h3><span>{usage.cards.length} mit gespeichertem Lauf</span></div>
      {usage.cards.length ? <div className="usage-card-list">{usage.cards.slice(0, visibleCards).map((card) => {
        const details = cardDetails(card);
        const content = <><span className="usage-card-title">{card.title}</span><span className="usage-card-details">{details}</span></>;
        return availableCardIds.has(card.id)
          ? <button type="button" key={card.id} className="usage-card-row" onClick={() => onOpenCard(card.id)} aria-label={`${card.title}: ${details}; Aufgabe öffnen`}>{content}</button>
          : <div key={card.id} className="usage-card-row is-missing">{content}<span>Aufgabe nicht mehr verfügbar</span></div>;
      })}</div> : <p className="usage-empty">In diesem Zeitraum gibt es keine gespeicherten Aufgabenläufe.</p>}
      {usage.cards.length > visibleCards ? <button type="button" className="usage-card-toggle" onClick={() => setVisibleCards((value) => value + 40)}>
        Weitere {Math.min(40, usage.cards.length - visibleCards)} Aufgaben anzeigen
      </button> : null}
    </section>
    <p className="usage-provenance">Quelle: lokale Sitzungseinträge und gespeicherte Startzuordnung. Laufzeiten sind summiert; parallele Läufe überschneiden sich. Vor dieser Zuordnung gespeicherte Sitzungen ohne eindeutigen Workflow-Beleg erscheinen als „Historisch ungeklärt“.</p>
    </>}
  </section>;
}
