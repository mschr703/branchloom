import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenSession: (cardId: string, sessionId: string) => void;
}

export function BoardSessionDock({ snapshot, onOpenSession }: Props) {
  const running = snapshot.sessions.filter((session) => session.state === 'running');
  const [expanded, setExpanded] = useState(running.length > 0);
  const previousCount = useRef(running.length);

  useEffect(() => {
    if (running.length > previousCount.current) setExpanded(true);
    previousCount.current = running.length;
  }, [running.length]);

  return <section className="board-session-dock" aria-label="Agentensitzungen">
    <button type="button" className="board-session-toggle" aria-expanded={expanded} aria-controls={expanded ? 'board-session-list' : undefined} onClick={() => setExpanded((value) => !value)}>
      <Terminal size={15} aria-hidden="true" />
      <span>Agentensitzungen</span>
      <strong>{running.length} aktiv</strong>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {expanded ? <div id="board-session-list" className="board-session-list">
      {running.length ? running.map((session) => {
        const card = snapshot.cards.find((item) => item.id === session.cardId);
        const agent = snapshot.agents.find((item) => item.id === session.agentId);
        const started = new Date(session.startedAt);
        const startedLabel = Number.isNaN(started.getTime()) ? 'Startzeit unbekannt' : `Start ${new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(started)}`;
        return <button type="button" key={session.id} className="board-session-row" disabled={!card} onClick={() => { if (card) onOpenSession(card.id, session.id); }}>
          <span className="board-session-running" aria-hidden="true" />
          <span className="board-session-title">{card?.title ?? 'Karte nicht mehr verfügbar'}</span>
          <span className="board-session-meta">{agent?.name ?? 'Agent unbekannt'} · {startedLabel}</span>
          <span className="board-session-action">Sitzung öffnen</span>
        </button>;
      }) : <p className="board-session-empty">Gerade läuft kein Agent. Starte eine Karte über ihre Agentenspalte oder ihre Details.</p>}
    </div> : null}
  </section>;
}
