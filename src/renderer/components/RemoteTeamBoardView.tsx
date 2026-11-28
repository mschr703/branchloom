import { useEffect, useState } from 'react';
import { Layers2, Play, Search } from 'lucide-react';
import type { CollaborativeTeamBoard } from '../../main/team-remote-client';
import { CARD_PRIORITIES } from '../../shared/card-metadata';
import { TeamCardDraftEditor } from './TeamCardDraftEditor';
import { TeamCardPriorityControl } from './TeamCardPriorityControl';
import { TeamCardColumnControl } from './TeamCardColumnControl';
import './remote-team-board.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const isTransportOutage = (message: string) => /(?:^|: )Coordinator is unavailable\.$/.test(message);

/** A member's board reads the host's canonical cards; it never writes a local project copy. */
export function RemoteTeamBoardView({ workspaceId, projectId, projectName, onTeam }: {
  workspaceId: string; projectId: string; projectName: string; onTeam: () => void;
}) {
  const [board, setBoard] = useState<CollaborativeTeamBoard | null>(null);
  const [rights, setRights] = useState<{ canEditDraft: boolean; canManageTask: boolean } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => { setSelectedId(null); }, [workspaceId, projectId]);

  useEffect(() => {
    if (!selectedId) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedId(null); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    let loading = false;
    setBoard(null); setRights(null); setError('');
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const [nextBoard, workspace] = await Promise.all([
          window.studio.teamBoard({ workspaceId, projectId }), window.studio.teamWorkspace(workspaceId),
        ]);
        const project = workspace.projects.find((item) => item.id === projectId);
        if (!project) throw new Error('No longer authorized for this project.');
        if (active) { setBoard(nextBoard); setRights(project); setError(''); }
      } catch (reason) {
        // Drop cached project data on every failure. Retain only the card ID
        // across a transport outage so its encrypted outbox can replay on reconnect.
        if (active) {
          const message = errorText(reason);
          setBoard(null); setRights(null); setError(message);
          if (!isTransportOutage(message)) setSelectedId(null);
        }
      } finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 3_000);
    return () => { active = false; clearInterval(timer); };
  }, [workspaceId, projectId, reloadToken]);

  const reload = async () => {
    const next = await window.studio.teamBoard({ workspaceId, projectId });
    setBoard(next);
  };
  const selected = board?.cards.find((card) => card.id === selectedId);
  const matching = board?.cards.filter((card) => card.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  const running = board?.cards.filter((card) => card.runningSince) ?? [];
  return <div className="board-page remote-team-board" aria-label="Gemeinsames Board">
    <div className="board-project-masthead"><div className="board-project-identity"><h2>{board?.projectName ?? projectName}</h2>
      <span>Gemeinsames Projekt · {board ? `${board.cards.length}${board.truncated ? '+' : ''} Karten · ${board.columns.length} Spalten` : 'Verbindung wird geprüft'}</span></div>
      <button className="text-button" type="button" onClick={onTeam}>Team &amp; Rechte</button></div>
    {running.length > 0 ? <div className="board-live-strip" role="status"><span className="board-live-summary"><i aria-hidden="true" />{running.length} {running.length === 1 ? 'Agent aktiv' : 'Agenten aktiv'}</span>
      {running.slice(0, 2).map((card) => <button type="button" key={card.id} onClick={() => setSelectedId(card.id)}>{card.title}</button>)}</div> : null}
    <div className="board-toolbar board-header-actions"><nav className="board-view-tabs" aria-label="Projektansichten"><span className="is-active" aria-current="page">Board</span><button type="button" onClick={onTeam}>Team</button></nav></div>
    <div className="board-filters" role="search" aria-label="Board-Filter"><label className="board-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Karten suchen…" aria-label="Karten suchen" /></label>
      {query ? <span className="board-filter-count" role="status">{matching.length} Treffer</span> : null}<button className="text-button" type="button" onClick={() => setReloadToken((value) => value + 1)}>Aktualisieren</button></div>
    {error ? <p className="inline-error remote-team-board-error" role="alert">Gemeinsames Board nicht erreichbar: {error}</p> : null}
    {!board && !error ? <p className="content-message" role="status">Gemeinsames Board wird geladen…</p> : null}
    {board ? <><div className="board-columns" aria-label="Gemeinsame Projektspalten">{board.columns.map((column) => {
      const cards = matching.filter((card) => card.columnId === column.id);
      return <section className="board-column" data-run-mode={column.startsAgent ? 'automatic' : 'manual'} key={column.id} aria-label={`Spalte ${column.name}`}>
        <header className="column-header"><div className="column-heading"><div className="column-title"><span className="column-indicator" aria-hidden="true">{column.startsAgent ? <Play size={13} /> : <Layers2 size={14} />}</span><h3>{column.name}</h3><span className="count-pill">{cards.length}</span></div></div></header>
        <div className="column-body">{cards.map((card) => <div className="board-card-wrap" key={card.id}><button type="button" className={`task-card${card.runningSince ? ' is-running' : ''}`} data-priority={card.priority} data-run-state={card.runningSince ? 'running' : 'none'} aria-label={`Karte „${card.title}“ in „${column.name}“ öffnen`} aria-pressed={selectedId === card.id} onClick={() => { setSelectedId(card.id); setNotice(''); }}>
          <span className="task-card-kicker"><span>#{card.id.slice(0, 6)}</span>{card.priority !== 'none' ? <span className={`task-card-priority-text priority-${card.priority}`}>{CARD_PRIORITIES.find((item) => item.value === card.priority)?.label ?? card.priority}</span> : null}</span><strong>{card.title}</strong><span className="task-card-footer"><span className="task-card-agent-state">{card.runningSince ? 'Agent arbeitet' : 'Gemeinsamer Entwurf'}</span></span>
        </button></div>)}{cards.length === 0 ? <p className="empty-column">{query ? 'Keine passenden Karten' : 'Noch keine Karten'}</p> : null}</div>
      </section>;
    })}</div>{board.truncated ? <p className="remote-team-board-limit">Der Koordinator zeigt derzeit höchstens 200 Karten. Nutze die Teamansicht für weitere Projektinformationen.</p> : null}</> : null}
    {selected && rights && board ? <div className="remote-team-card-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}><aside className="remote-team-card-detail" role="dialog" aria-modal="true" aria-label={`Karte ${selected.title}`}>
      <header><div><small>Gemeinsame Karte · #{selected.id.slice(0, 6)}</small><h3>{selected.title}</h3></div><button className="icon-button" type="button" onClick={() => setSelectedId(null)} aria-label="Karte schließen">×</button></header>
      {notice ? <p className="inline-note" role="status">{notice}</p> : null}
      <TeamCardDraftEditor key={`${workspaceId}:${projectId}:${selected.id}`} workspaceId={workspaceId} projectId={projectId} cardId={selected.id} cardTitle={selected.title} canEdit={rights.canEditDraft} onCardChanged={() => void reload().catch((reason: unknown) => setError(errorText(reason)))} />
      {rights.canManageTask ? <><TeamCardPriorityControl key={`priority:${selected.id}:${selected.revision}`} workspaceId={workspaceId} projectId={projectId} card={selected} onReload={reload} onSaved={() => setNotice('Priorität gespeichert.')} />
        <TeamCardColumnControl key={`column:${selected.id}:${selected.revision}`} workspaceId={workspaceId} projectId={projectId} card={selected} columns={board.columns} onReload={reload} onSaved={(state) => setNotice(state === 'started' ? 'Spalte gespeichert. Agent auf dem Host gestartet.' : state ? 'Spalte gespeichert. Prüfe den Agentenstart im Host.' : 'Spalte gespeichert. Kein Agent gestartet.')} /></> : null}
    </aside></div> : null}
  </div>;
}
