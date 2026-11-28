import { useEffect, useRef, useState } from 'react';
import type { SavedTeamConnection } from '../../main/team-connection-store';
import type { HostedTeamWorkspace } from '../../main/team-local-service';
import type { CollaborativeTeamBoard, TeamProjectMember } from '../../main/team-remote-client';
import type { TeamRole } from '../../main/team-workspace';
import { TeamCardDraftEditor } from './TeamCardDraftEditor';
import { TeamCardPriorityControl } from './TeamCardPriorityControl';
import { TeamCardColumnControl } from './TeamCardColumnControl';
import { TeamWorkspaceSettings } from './TeamWorkspaceSettings';
import './team-workspace-view.css';

const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
type RemoteWorkspace = { member: { displayName: string; role: string }; projects: Array<{ id: string; name: string; canEditDraft: boolean; canManageTask: boolean }> };

const roleNames: Record<string, string> = { owner: 'Owner', admin: 'Admin', editor: 'Mitglied', developer: 'Entwicklung', viewer: 'Ansicht' };
const accessNames: Record<string, string> = { none: 'Kein Projektzugang', read: 'Nur lesen', edit: 'Mitarbeiten' };
type HostedMember = HostedTeamWorkspace['members'][number];
type MemberSort = 'role' | 'name' | 'access';
const roleOrder: Record<HostedMember['role'], number> = { owner: 0, admin: 1, editor: 2, developer: 3, viewer: 4 };
const memberCollator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

function memberAccessLabel(member: HostedTeamWorkspace['members'][number], projectDefault: HostedTeamWorkspace['defaultMemberAccess']): string {
  const access = member.role === 'owner' ? 'edit' : member.projectAccess ?? projectDefault;
  if (access !== 'edit') return accessNames[access] ?? 'Kein Projektzugang';
  if (member.role === 'viewer') return member.extraCapabilities.some((capability) => capability !== 'read') ? 'Zusatzrechte' : 'Nur lesen';
  if (member.role === 'developer') return member.extraCapabilities.some((capability) => capability !== 'read' && capability !== 'edit_draft') ? 'Entwurf & Zusatzrechte' : 'Entwurf bearbeiten';
  return 'Mitarbeiten';
}

function accessOrder(member: HostedMember, projectDefault: HostedTeamWorkspace['defaultMemberAccess']): number {
  const access = memberAccessLabel(member, projectDefault);
  return access === 'Kein Projektzugang' ? 2 : access === 'Nur lesen' ? 1 : 0;
}

export function sortTeamMembers(members: HostedMember[], sort: MemberSort, projectDefault: HostedTeamWorkspace['defaultMemberAccess']): HostedMember[] {
  return members.filter((member) => !member.revokedAt).sort((a, b) => {
    const rank = sort === 'role' ? roleOrder[a.role] - roleOrder[b.role]
      : sort === 'access' ? accessOrder(a, projectDefault) - accessOrder(b, projectDefault) : 0;
    return rank || memberCollator.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id);
  });
}

export function memberMonogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}`.toLocaleUpperCase() : (parts[0] ?? '?').slice(0, 2).toLocaleUpperCase();
}

function projectMemberAccess(member: TeamProjectMember): string {
  if (member.canManageTask && member.canStartAgent) return 'Aufgaben & Agenten';
  if (member.canManageTask) return 'Aufgaben verwalten';
  if (member.canEditDraft) return 'Entwürfe bearbeiten';
  return 'Nur lesen';
}

const assignableRoles: Array<Exclude<TeamRole, 'owner'>> = ['admin', 'editor', 'developer', 'viewer'];

export function TeamMemberRoleControl({ member, workspaceId, onSaved }: {
  member: HostedMember; workspaceId: string; onSaved: () => void;
}) {
  const [nextRole, setNextRole] = useState<Exclude<TeamRole, 'owner'>>(member.role === 'owner' ? 'viewer' : member.role);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mutationId = useRef<string | null>(null);
  useEffect(() => {
    setNextRole(member.role === 'owner' ? 'viewer' : member.role);
    setConfirm(false); setError(''); mutationId.current = null;
  }, [member.role, member.roleRevision]);
  const changed = nextRole !== member.role;
  async function apply() {
    if (!changed || busy) return;
    if (!confirm) { setConfirm(true); return; }
    setBusy(true); setError('');
    try {
      mutationId.current ??= crypto.randomUUID();
      await window.studio.changeTeamMemberRole({ workspaceId, memberId: member.id, role: nextRole,
        expectedRevision: member.roleRevision, mutationId: mutationId.current });
      mutationId.current = null; setConfirm(false); onSaved();
    } catch (reason) { setError(messageOf(reason)); setConfirm(false); }
    finally { setBusy(false); }
  }
  return <details className="team-member-role-control"><summary>Rolle ändern</summary>
    <label>Neue Rolle<select aria-label={`${member.displayName}: Rolle wählen`} value={nextRole}
      disabled={busy} onChange={(event) => { setNextRole(event.currentTarget.value as Exclude<TeamRole, 'owner'>); setConfirm(false); setError(''); mutationId.current = null; }}>
      {assignableRoles.map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}
    </select></label>
    <p>Zusätzliche Projektrechte dieses Mitglieds werden bei einer Rollenänderung entfernt.</p>
    <button type="button" className="secondary-button" disabled={!changed || busy} onClick={() => void apply()}>
      {busy ? 'Speichert…' : confirm ? 'Rollenänderung bestätigen' : 'Änderung prüfen'}
    </button>
    {error ? <p className="inline-error" role="alert">{error} · Mitglieder aktualisieren und erneut prüfen.</p> : null}
  </details>;
}

export function TeamMemberOverview({ hosted, projectMembers, rosterError, currentMemberId, fallbackMember, onRefresh, workspaceId, onRoleChanged }: {
  hosted: HostedTeamWorkspace | null;
  projectMembers?: TeamProjectMember[] | null;
  rosterError?: string;
  currentMemberId?: string;
  fallbackMember?: RemoteWorkspace['member'];
  onRefresh?: () => void;
  workspaceId?: string;
  onRoleChanged?: () => void;
}) {
  const [sort, setSort] = useState<MemberSort>('role');
  const members = hosted ? sortTeamMembers(hosted.members, sort, hosted.defaultMemberAccess) : [];
  const visibleProjectMembers = projectMembers ? [...projectMembers].sort((a, b) => {
    const rank = sort === 'role' ? roleOrder[a.role] - roleOrder[b.role]
      : sort === 'access' ? (a.projectAccess === 'edit' ? 0 : 1) - (b.projectAccess === 'edit' ? 0 : 1) : 0;
    return rank || memberCollator.compare(a.displayName, b.displayName) || a.id.localeCompare(b.id);
  }) : null;
  return <section className="team-members-overview" aria-label="Mitglieder">
    <div className="team-section-heading"><div><h3>Mitglieder</h3><p>{hosted ? `${members.length} im Workspace · Rechte für dieses Projekt` : visibleProjectMembers ? `${visibleProjectMembers.length} mit Projektzugang` : 'Projektmitglieder werden geladen'}</p></div>
      {hosted || visibleProjectMembers ? <div className="team-members-controls"><label>Sortieren<select aria-label="Mitglieder sortieren" value={sort} onChange={(event) => setSort(event.currentTarget.value as MemberSort)}><option value="role">Rolle</option><option value="name">Name</option><option value="access">Projektzugang</option></select></label>{onRefresh ? <button type="button" className="text-button" onClick={onRefresh}>Aktualisieren</button> : null}</div> : null}</div>
    {hosted ? <ul className="team-members-list">{members.map((member) => {
      return <li key={member.id}><span className="team-member-avatar" aria-hidden="true">{memberMonogram(member.displayName)}</span><div className="team-member-identity"><strong>{member.displayName}</strong>{member.id === currentMemberId ? <small>Du</small> : null}</div><span className="team-member-role">{roleNames[member.role] ?? member.role}{workspaceId && onRoleChanged && currentMemberId && member.id !== currentMemberId && member.role !== 'owner' ? <TeamMemberRoleControl member={member} workspaceId={workspaceId} onSaved={onRoleChanged} /> : null}</span><span className="team-member-access">{memberAccessLabel(member, hosted.defaultMemberAccess)}</span></li>;
    })}</ul> : visibleProjectMembers ? <ul className="team-members-list">{visibleProjectMembers.map((member) => <li key={member.id}>
      <span className="team-member-avatar" aria-hidden="true">{memberMonogram(member.displayName)}</span>
      <div className="team-member-identity"><strong>{member.displayName}</strong>{member.id === currentMemberId ? <small>Du</small> : null}</div>
      <span className="team-member-role">{roleNames[member.role] ?? member.role}</span>
      <span className="team-member-access">{projectMemberAccess(member)}</span>
    </li>)}</ul> : rosterError ? <p className="inline-error" role="alert">Mitgliederliste nicht erreichbar: {rosterError}</p>
      : fallbackMember ? <p className="team-workspace-muted">Mitglieder werden geladen…</p> : <p className="team-workspace-muted">Mitglieder werden geladen…</p>}
  </section>;
}

export function TeamWorkspaceView({ projectId }: { projectId?: string }) {
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [connections, setConnections] = useState<SavedTeamConnection[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspace, setWorkspace] = useState<RemoteWorkspace | null>(null);
  const [hosted, setHosted] = useState<HostedTeamWorkspace | null>(null);
  const [projectMembers, setProjectMembers] = useState<TeamProjectMember[] | null>(null);
  const [rosterError, setRosterError] = useState('');
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

  useEffect(() => {
    if (!remoteProjectId || connections.find((item) => item.workspaceId === workspaceId)?.role !== 'owner') { setHosted(null); return; }
    let active = true;
    setHosted(null);
    void window.studio.hostedTeamProject(remoteProjectId).then((next) => { if (active) setHosted(next); })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [workspaceId, remoteProjectId, connections, refreshToken]);

  useEffect(() => {
    if (!workspaceId || !remoteProjectId || connections.find((item) => item.workspaceId === workspaceId)?.role === 'owner') {
      setProjectMembers(null); setRosterError(''); return;
    }
    let active = true;
    setProjectMembers(null); setRosterError('');
    const load = () => { void window.studio.teamProjectMembers({ workspaceId, projectId: remoteProjectId })
      .then((members) => { if (active) { setProjectMembers(members); setRosterError(''); } })
      .catch((reason: unknown) => { if (active) { setProjectMembers(null); setRosterError(messageOf(reason)); } }); };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [workspaceId, remoteProjectId, connections, refreshToken]);

  const selectedCard = board?.cards.find((card) => card.id === cardId);
  return <div className="team-workspace-page standard-page">
    <header className="team-workspace-header"><div><h2>Team</h2><p>Mitglieder, Projektrechte und gemeinsame Entwürfe.</p></div>
      {connections.length ? <button type="button" className="secondary-button" onClick={() => { if (settingsRef.current) { settingsRef.current.open = true; settingsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }}>Einladen &amp; Rechte</button> : null}</header>
    {connections.length ? <div className="team-workspace-content">
      <div className="team-workspace-switches"><label>Workspace<select value={workspaceId} onChange={(event) => setWorkspaceId(event.currentTarget.value)}>
        {connections.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.displayName} · {item.role}</option>)}</select></label>
        {workspace?.projects.length ? <label>Projekt<select value={remoteProjectId} onChange={(event) => setRemoteProjectId(event.currentTarget.value)}>
          {workspace.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        {workspace ? <span>{workspace.member.displayName} · {roleNames[workspace.member.role] ?? workspace.member.role}</span> : null}</div>
      {workspace ? <TeamMemberOverview hosted={hosted} projectMembers={projectMembers} rosterError={rosterError} currentMemberId={connections.find((item) => item.workspaceId === workspaceId)?.memberId} fallbackMember={workspace.member} workspaceId={workspaceId} onRoleChanged={() => setRefreshToken((value) => value + 1)} onRefresh={() => setRefreshToken((value) => value + 1)} /> : null}
      {board ? <div className="team-workspace-board-layout"><div className="team-workspace-board" aria-label={`Gemeinsame Arbeit ${board.projectName}`}>
        <div className="team-workspace-board-heading"><div><h3>Gemeinsame Arbeit</h3><p>Dieselben Karten wie im Projekt-Board. Hier öffnest du einen gemeinsamen Entwurf.</p></div><span>{board.cards.length}{board.truncated ? '+' : ''} Karten · Stand {new Date(board.observedAt).toLocaleTimeString('de-DE')}</span></div>
        <div className="team-workspace-columns">{board.columns.filter((column) => board.cards.some((card) => card.columnId === column.id)).map((column) => <section key={column.id} aria-label={`Spalte ${column.name}`}>
          <h4>{column.name} <small>{board.cards.filter((card) => card.columnId === column.id).length}</small></h4>
          {board.cards.filter((card) => card.columnId === column.id).map((card) => <button key={card.id} type="button"
            className={cardId === card.id ? 'team-workspace-card selected' : 'team-workspace-card'} onClick={() => { setCardId(card.id); setActionNotice(''); }}
            aria-pressed={cardId === card.id}><strong>{card.title}</strong><small>{card.runningSince ? 'Agent arbeitet' : card.priority === 'none' ? 'Ohne Priorität' : card.priority}</small></button>)}
        </section>)}</div></div>
        <div className="team-workspace-detail">{selectedCard ? <>
          {actionNotice ? <p className="inline-note" role="status">{actionNotice}</p> : null}
          <TeamCardDraftEditor key={`${workspaceId}:${remoteProjectId}:${selectedCard.id}`}
            workspaceId={workspaceId} projectId={remoteProjectId} cardId={selectedCard.id} cardTitle={selectedCard.title}
            canEdit={workspace?.projects.find((item) => item.id === remoteProjectId)?.canEditDraft === true}
            onCardChanged={() => { void window.studio.teamBoard({ workspaceId, projectId: remoteProjectId })
              .then(setBoard).catch((reason: unknown) => setError(messageOf(reason))); }} />
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
            }} /> : null}</>
          : <p>Wähle eine Karte, um den gemeinsamen Entwurf zu öffnen.</p>}</div></div> : null}
      {!board && !error ? <p className="team-workspace-muted">Gemeinsame Arbeit wird geladen…</p> : null}
    </div> : null}
    <details ref={settingsRef} className="team-workspace-setup" open={!connections.length ? true : undefined}>
      <summary>{connections.length ? 'Workspace verwalten oder beitreten' : 'Workspace erstellen oder Einladung annehmen'}</summary>
      <TeamWorkspaceSettings projectId={projectId} onConnectionChange={() => setRefreshToken((value) => value + 1)} />
    </details>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>;
}
