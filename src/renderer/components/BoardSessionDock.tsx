import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import { readableSessionOutput } from '../activity-transcript';

interface Props {
  snapshot: ProjectSnapshot;
  onOpenSession: (cardId: string, sessionId: string) => void;
}

export function sessionOutputPreview(output: string): string {
  return readableSessionOutput(output).split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0).slice(-3).join('\n').slice(-480);
}

export function BoardSessionDock({ snapshot, onOpenSession }: Props) {
  const running = snapshot.sessions.filter((session) => session.state === 'running');
  const recent = [...snapshot.sessions].filter((session) => session.state !== 'running').sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 3);
  const visible = running.length ? running : recent;
  const latestOutput = running[0] ? sessionOutputPreview(running[0].output) : '';
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
      {visible.length ? visible.map((session) => {
        const card = snapshot.cards.find((item) => item.id === session.cardId);
        const agent = snapshot.agents.find((item) => item.id === session.agentId);
        const started = new Date(session.startedAt);
        const startedLabel = Number.isNaN(started.getTime()) ? 'Startzeit unbekannt' : `Start ${new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(started)}`;
        return <button type="button" key={session.id} className="board-session-row" disabled={!card} onClick={() => { if (card) onOpenSession(card.id, session.id); }}>
          <span className={`board-session-running state-${session.state}`} aria-hidden="true" />
          <span className="board-session-title">{card?.title ?? 'Karte nicht mehr verfügbar'}</span>
          <span className="board-session-meta">{agent?.name ?? 'Agent unbekannt'} · {session.state === 'running' ? 'Läuft' : session.state === 'failed' ? 'Fehler' : session.state === 'stopped' ? 'Gestoppt' : 'Beendet'} · {startedLabel}</span>
          <span className="board-session-action">Sitzung öffnen</span>
        </button>;
      }) : <p className="board-session-empty">Noch keine Agentensitzung in diesem Projekt. Starte eine Karte, um ihren Verlauf hier zu sehen.</p>}
      {latestOutput ? <div className="board-session-preview"><span>Letzte Ausgabe · {snapshot.agents.find((item) => item.id === running[0]!.agentId)?.name ?? 'Agent'}</span><pre aria-label="Letzte Agentenausgabe">{latestOutput}</pre></div> : null}
    </div> : null}
  </section>;
}
