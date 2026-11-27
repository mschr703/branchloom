import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import type { ProjectSnapshot, Session } from '../../shared/types';
import { observedSessionActivity, readableSessionOutput } from '../activity-transcript';
import './board-session-dock.css';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenSession: (cardId: string, sessionId: string) => void;
}

/** Quote recorded output only. Structured protocol frames belong in the full session. */
export function sessionOutputPreview(output: string, maxLines = 3, maxChars = 480): string {
  return readableSessionOutput(output).split('\n').map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !/^\s*\{\s*"type"\s*:/.test(line))
    .slice(-maxLines).join('\n').slice(-maxChars);
}

const stateLabel = (session: Session) => session.state === 'running' ? 'Läuft' : session.state === 'failed' ? 'Fehler' : session.state === 'stopped' ? 'Gestoppt' : 'Beendet';

export function BoardSessionDock({ snapshot, onOpenSession }: Props) {
  const running = snapshot.sessions.filter((session) => session.state === 'running').sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const recent = [...snapshot.sessions].filter((session) => session.state !== 'running').sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 3);
  const visible = running.length ? running : recent;
  const [expanded, setExpanded] = useState(running.length > 0);
  const [agentFilter, setAgentFilter] = useState('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const previousCount = useRef(running.length);
  const agentOptions = [...new Set(visible.map((session) => session.agentId))].map((id) => ({
    id, name: snapshot.agents.find((agent) => agent.id === id)?.name ?? 'Agent unbekannt',
  }));
  const agentOptionKey = agentOptions.map((agent) => agent.id).join('|');
  const filtered = agentFilter === 'all' ? visible : visible.filter((session) => session.agentId === agentFilter);
  const selected = filtered.find((session) => session.id === selectedSessionId) ?? filtered[0] ?? null;
  const selectedCard = selected ? snapshot.cards.find((card) => card.id === selected.cardId) : null;
  const selectedAgent = selected ? snapshot.agents.find((agent) => agent.id === selected.agentId) : null;
  const excerpt = selected ? sessionOutputPreview(selected.output, 9, 1500) : '';

  useEffect(() => {
    if (running.length > previousCount.current) setExpanded(true);
    previousCount.current = running.length;
  }, [running.length]);
  useEffect(() => {
    if (agentFilter !== 'all' && !agentOptions.some((agent) => agent.id === agentFilter)) setAgentFilter('all');
  }, [agentFilter, agentOptionKey]);

  return <section className="board-session-dock" aria-label="Agentensitzungen">
    <button type="button" className="board-session-toggle" aria-expanded={expanded} aria-controls={expanded ? 'board-session-list' : undefined} onClick={() => setExpanded((value) => !value)}>
      <Terminal size={15} aria-hidden="true" />
      <span>Agentensitzungen</span>
      <strong>{running.length} aktiv</strong>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {expanded ? <div id="board-session-list" className="board-session-list board-session-workspace">
      <div className="board-session-filters">
        <div className="board-session-scope" role="group" aria-label="Laufquelle">
          <button type="button" aria-pressed="true">Alle</button>
          <button type="button" disabled title="Sitzungen haben noch keine verlässliche Mitgliedszuordnung.">Meine</button>
          <button type="button" disabled title="Team-Agenten benötigen zugeordnete Worker-Läufe.">Team</button>
        </div>
        <label>Agent <select aria-label="Agent filtern" value={agentFilter} onChange={(event) => { setAgentFilter(event.target.value); setSelectedSessionId(null); }}>
          <option value="all">Alle Agenten</option>{agentOptions.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select></label>
        <span className="board-session-scope-note">Meine/Team: Mitgliedszuordnung fehlt noch</span>
      </div>
      {visible.length ? <div className="board-session-layout">
        <div className="board-session-agent-list" aria-label={running.length ? 'Laufende Agenten' : 'Letzte Agentenläufe'}>
          {filtered.map((session) => {
            const card = snapshot.cards.find((item) => item.id === session.cardId);
            const agent = snapshot.agents.find((item) => item.id === session.agentId);
            const activity = observedSessionActivity(session.output);
            return <button type="button" key={session.id} className="board-session-agent" aria-pressed={selected?.id === session.id} onClick={() => setSelectedSessionId(session.id)}>
              <span className={'board-session-running state-' + session.state} aria-hidden="true" />
              <span className="board-session-agent-copy"><strong>{agent?.name ?? 'Agent unbekannt'}</strong><small>{card?.title ?? 'Karte nicht mehr verfügbar'}</small><span>{activity ?? (session.state === 'running' ? 'Wartet auf erste Ausgabe' : 'Keine Ausgabe gespeichert')}</span></span>
              <span className="board-session-agent-state">{stateLabel(session)}</span>
            </button>;
          })}
          {!filtered.length ? <p className="board-session-empty">Für diesen Agenten ist gerade kein Lauf sichtbar.</p> : null}
        </div>
        {selected ? <section className="board-session-detail" aria-label="Ausgewählter Agentenlauf">
          <header><div><strong>{selectedAgent?.name ?? 'Agent unbekannt'}</strong><span>{stateLabel(selected)} · {Number.isNaN(Date.parse(selected.startedAt)) ? 'Startzeit unbekannt' : 'Start ' + new Date(selected.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span></div>
            {selectedCard ? <button type="button" onClick={() => onOpenSession(selectedCard.id, selected.id)}>Sitzung öffnen</button> : null}</header>
          <p>{selectedCard?.title ?? 'Karte nicht mehr verfügbar'}</p>
          <pre role="log" aria-live="off" aria-label="Zuletzt aufgezeichnete Agentenausgabe">{excerpt || (selected.state === 'running' ? 'Noch keine Ausgabe des laufenden Agenten.' : 'Keine Ausgabe gespeichert.')}</pre>
        </section> : null}
      </div> : <p className="board-session-empty">Noch keine Agentensitzung in diesem Projekt. Starte eine Karte, um ihren Verlauf hier zu sehen.</p>}
    </div> : null}
  </section>;
}
