import { useEffect, useState } from 'react';
import type { SavedTeamConnection } from '../../main/team-connection-store';
import type { CollaborativeTeamBoard } from '../../main/team-remote-client';
import { TeamCardDraftEditor } from './TeamCardDraftEditor';
import { TeamCardPriorityControl } from './TeamCardPriorityControl';
import { TeamCardColumnControl } from './TeamCardColumnControl';
import { TeamWorkspaceSettings } from './TeamWorkspaceSettings';
import './team-workspace-view.css';

const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
type RemoteWorkspace = { member: { displayName: string; role: string }; projects: Array<{ id: string; name: string; canEditDraft: boolean; canManageTask: boolean }> };

export function TeamWorkspaceView({ projectId }: { projectId?: string }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [connections, setConnections] = useState<SavedTeamConnection[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspace, setWorkspace] = useState<RemoteWorkspace | null>(null);
  const [remoteProjectId, setRemoteProjectId] = useState('');
  const [board, setBoard] = useState<CollaborativeTeamBoard | null>(null);
  const [cardId, setCardId] = useState('');
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState('');

  useEffect(() => {
    let active = true;
    void window.studio.teamConnections().then((items) => {
      if (!active) return;
      setConnections(items);
      setWorkspaceId((current) => items.some((item) => item.workspaceId === current) ? current : items[0]?.workspaceId ?? '');
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [refreshToken]);

  useEffect(() => {
    if (!workspaceId) { setWorkspace(null); setRemoteProjectId(''); return; }
    let active = true;
    setError(''); setActionNotice(''); setWorkspace(null); setBoard(null); setCardId('');
    const load = () => { void window.studio.teamWorkspace(workspaceId).then((next) => {
      if (!active) return;
      setWorkspace(next);
      setRemoteProjectId((current) => next.projects.some((item) => item.id === current) ? current : next.projects[0]?.id ?? '');
      setError('');
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); }); };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [workspaceId, refreshToken]);

  useEffect(() => {
    if (!workspaceId || !remoteProjectId) { setBoard(null); return; }
    let active = true;
    setBoard(null); setCardId(''); setActionNotice('');
    const load = () => { void window.studio.teamBoard({ workspaceId, projectId: remoteProjectId }).then((next) => {
      if (!active) return;
      setBoard(next); setError('');
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); }); };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 3_000);
    return () => { active = false; clearInterval(timer); };
  }, [workspaceId, remoteProjectId]);

  const selectedCard = board?.cards.find((card) => card.id === cardId);
  return <div className="team-workspace-page standard-page">
    <p className="team-workspace-intro">Gemeinsame Projekte, Mitglieder und Entwürfe. Auf diesem Gerät läuft der Koordinator nur lokal.</p>
    <details className="team-workspace-setup" open={!connections.length ? true : undefined}>
      <summary>{connections.length ? 'Workspace verwalten oder beitreten' : 'Workspace erstellen oder Einladung annehmen'}</summary>
      <TeamWorkspaceSettings projectId={projectId} onConnectionChange={() => setRefreshToken((value) => value + 1)} />
    </details>
    {connections.length ? <div className="team-workspace-content">
      <div className="team-workspace-switches"><label>Workspace<select value={workspaceId} onChange={(event) => setWorkspaceId(event.currentTarget.value)}>
        {connections.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.displayName} · {item.role}</option>)}</select></label>
        {workspace?.projects.length ? <label>Projekt<select value={remoteProjectId} onChange={(event) => setRemoteProjectId(event.currentTarget.value)}>
          {workspace.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        {workspace ? <span>{workspace.member.displayName} · {workspace.member.role}</span> : null}</div>
      {board ? <div className="team-workspace-board-layout"><div className="team-workspace-board" aria-label={`Teamboard ${board.projectName}`}>
        <div className="team-workspace-board-heading"><h3>{board.projectName}</h3><span>{board.cards.length}{board.truncated ? '+' : ''} Karten · Stand {new Date(board.observedAt).toLocaleTimeString('de-DE')}</span></div>
        <div className="team-workspace-columns">{board.columns.map((column) => <section key={column.id} aria-label={`Spalte ${column.name}`}>
          <h4>{column.name} <small>{board.cards.filter((card) => card.columnId === column.id).length}</small></h4>
          {board.cards.filter((card) => card.columnId === column.id).map((card) => <button key={card.id} type="button"
            className={cardId === card.id ? 'team-workspace-card selected' : 'team-workspace-card'} onClick={() => { setCardId(card.id); setActionNotice(''); }}
            aria-pressed={cardId === card.id}><strong>{card.title}</strong><small>{card.runningSince ? 'Agent aktiv' : card.priority === 'none' ? 'Ohne Priorität' : card.priority}</small></button>)}
        </section>)}</div></div>
        <div className="team-workspace-detail">{selectedCard ? <>
          {actionNotice ? <p className="inline-note" role="status">{actionNotice}</p> : null}
          {workspace?.projects.find((item) => item.id === remoteProjectId)?.canManageTask ? <TeamCardPriorityControl
            key={`${selectedCard.id}:${selectedCard.revision}`} workspaceId={workspaceId} projectId={remoteProjectId}
            card={selectedCard} onSaved={() => setActionNotice('Priorität gespeichert.')} onReload={async () => {
              setBoard(await window.studio.teamBoard({ workspaceId, projectId: remoteProjectId }));
            }} /> : null}
          {workspace?.projects.find((item) => item.id === remoteProjectId)?.canManageTask ? <TeamCardColumnControl
            key={`column:${selectedCard.id}:${selectedCard.revision}`} workspaceId={workspaceId} projectId={remoteProjectId}
            card={selectedCard} columns={board.columns} onSaved={(agentState) => setActionNotice(
              agentState === 'started' ? 'Spalte gespeichert. Agent im eigenen Worktree gestartet.' :
                agentState === 'failed' ? 'Spalte gespeichert. Agentenstart auf dem Host fehlgeschlagen; prüfe die Agent-Einstellungen und starte danach bewusst neu.' :
                  agentState ? 'Spalte gespeichert. Agentenstart ist noch ungeklärt; prüfe die Sitzungen.' :
                    'Spalte gespeichert. Kein Agent wurde gestartet.')} onReload={async () => {
              setBoard(await window.studio.teamBoard({ workspaceId, projectId: remoteProjectId }));
            }} /> : null}
          <TeamCardDraftEditor key={`${workspaceId}:${remoteProjectId}:${selectedCard.id}`}
            workspaceId={workspaceId} projectId={remoteProjectId} cardId={selectedCard.id} cardTitle={selectedCard.title}
            canEdit={workspace?.projects.find((item) => item.id === remoteProjectId)?.canEditDraft === true}
            onCardChanged={() => { void window.studio.teamBoard({ workspaceId, projectId: remoteProjectId })
              .then(setBoard).catch((reason: unknown) => setError(messageOf(reason))); }} /></>
          : <p>Wähle eine Karte, um den gemeinsamen Entwurf zu öffnen.</p>}</div></div> : null}
      {!board && !error ? <p className="team-workspace-muted">Teamboard wird geladen…</p> : null}
    </div> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>;
}
