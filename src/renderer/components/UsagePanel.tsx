import { useEffect, useMemo, useState } from 'react';
import type { ProjectSnapshot } from '../../shared/types';
import type { UsageSessionPage } from '../../shared/usage';
import { formatUsageDuration, projectUsage, usageStart, type UsagePeriod } from '../usage-data';
import '../usage.css';

interface Props { snapshot: ProjectSnapshot; now: number; onShowAgent: (name: string) => void }

export function UsagePanel({ snapshot, now, onShowAgent }: Props) {
  const [period, setPeriod] = useState<UsagePeriod>(7);
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
  const maxRuns = Math.max(1, ...(usage?.days.map((day) => day.runs) ?? []));
  return <section className="usage-panel" aria-label="Projektnutzung">
    <div className="usage-toolbar"><p>Gespeicherte lokale Agentenläufe dieses Projekts</p><div className="usage-period" role="group" aria-label="Zeitraum">
      <button type="button" aria-pressed={period === 7} onClick={() => setPeriod(7)}>7 Tage</button>
      <button type="button" aria-pressed={period === 30} onClick={() => setPeriod(30)}>30 Tage</button>
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
      </section>
    </div>
    <p className="usage-provenance">Quelle: lokale Sitzungseinträge. Laufzeiten sind summiert; parallele Läufe überschneiden sich. Token und Providerkosten werden derzeit nicht verlässlich erfasst und deshalb nicht geschätzt.</p>
    </>}
  </section>;
}
