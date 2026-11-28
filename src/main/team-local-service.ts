import type { StudioStore } from './store';
import { TeamConnectionStore, teamCoordinatorTransport, type SavedTeamConnection } from './team-connection-store';
import { TeamCoordinatorHttp } from './team-coordinator-http';
import { activeTailnetIPv4 } from './team-review-tailnet';
import { verifyLanProxyOrigin } from './team-lan-proxy';
import { addTeamProject, authenticateTeamMember, createTeamMemberInvite, createTeamWorkspace, revokeTeamMember,
  setTeamCapabilityGrant, setTeamProjectAccess, type TeamCapability, type TeamMember, type TeamRole } from './team-workspace';

export interface HostedTeamMember extends TeamMember {
  roleRevision: number;
  projectAccess: 'none' | 'read' | 'edit' | null;
  extraCapabilities: TeamCapability[];
}

export interface HostedTeamWorkspace {
  workspaceId: string;
  name: string;
  projectId: string;
  coordinatorUrl: string;
  defaultMemberAccess: 'none' | 'read' | 'edit';
  members: HostedTeamMember[];
}

export interface OwnedTeamWorkspace {
  workspaceId: string;
  name: string;
  projectCount: number;
  memberCount: number;
}

export interface TeamTailnetStatus { enabled: boolean; coordinatorUrl: string | null }

/** Loopback is always the default; tailnet hosting requires a separate explicit action. */
export class TeamLocalService {
  private coordinator: TeamCoordinatorHttp | null = null;
  private agentStarter: ((cardId: string, agentId: string) => { id: string }) | null = null;
  private url: string | null = null;
  private starting: Promise<string> | null = null;
  private tailnetCoordinator: TeamCoordinatorHttp | null = null;
  private tailnetUrl: string | null = null;
  private tailnetStarting: Promise<string> | null = null;

  constructor(private readonly store: StudioStore, private readonly connections: TeamConnectionStore,
    private readonly tailnetAddress: () => Promise<string> = activeTailnetIPv4,
    private readonly verifyLan: typeof verifyLanProxyOrigin = verifyLanProxyOrigin) {}

  setAgentStarter(start: (cardId: string, agentId: string) => { id: string }): void {
    if (this.coordinator) throw new Error('Set the team agent worker before starting the coordinator.');
    this.agentStarter = start;
  }

  /** Restore the local coordinator after app restart without waiting for the Team page. */
  async resumeSavedHost(): Promise<string | null> {
    const owner = (await this.connections.list()).find((item) => item.role === 'owner' &&
      teamCoordinatorTransport(item.coordinatorUrl) === 'loopback' &&
      this.store.db.prepare('SELECT 1 FROM team_workspaces WHERE id = ?').get(item.workspaceId));
    if (!owner) return null;
    const connection = await this.connections.get(owner.workspaceId);
    if (!connection || authenticateTeamMember(this.store.db, connection.credential).id !== owner.memberId) {
      throw new Error('Saved team host credential does not match this workspace.');
    }
    return this.start();
  }

  async hostedProject(projectId: string): Promise<HostedTeamWorkspace | null> {
    const row = this.store.db.prepare(`SELECT workspace.id, workspace.name FROM team_projects linked
      JOIN team_workspaces workspace ON workspace.id = linked.workspace_id WHERE linked.project_id = ?`)
      .get(projectId) as { id: string; name: string } | undefined;
    if (!row) return null;
    const connection = await this.connections.get(row.id);
    if (!connection || connection.role !== 'owner' || teamCoordinatorTransport(connection.coordinatorUrl) !== 'loopback') {
      throw new Error('This device does not hold the team workspace owner credential.');
    }
    const owner = authenticateTeamMember(this.store.db, connection.credential);
    if (owner.id !== connection.memberId || owner.workspaceId !== row.id) {
      throw new Error('This device does not hold the team workspace owner credential.');
    }
    const coordinatorUrl = await this.start();
    if (connection.coordinatorUrl !== coordinatorUrl) await this.connections.save({ ...connection, coordinatorUrl });
    const projectDefault = this.store.db.prepare('SELECT access FROM team_project_defaults WHERE project_id = ?')
      .get(projectId) as { access: 'none' | 'read' | 'edit' } | undefined;
    const baseMembers = this.store.db.prepare(`SELECT id, workspace_id AS workspaceId, display_name AS displayName,
      role, role_revision AS roleRevision, revoked_at AS revokedAt FROM team_members WHERE workspace_id = ? ORDER BY created_at, id`)
      .all(row.id) as Array<TeamMember & { roleRevision: number }>;
    const access = new Map((this.store.db.prepare('SELECT member_id, access FROM team_project_permissions WHERE project_id = ?')
      .all(projectId) as Array<{ member_id: string; access: 'none' | 'read' | 'edit' }>).map((item) => [item.member_id, item.access]));
    const grants = new Map<string, TeamCapability[]>();
    for (const item of this.store.db.prepare('SELECT member_id, capability FROM team_project_capability_grants WHERE project_id = ?')
      .all(projectId) as Array<{ member_id: string; capability: TeamCapability }>) {
      grants.set(item.member_id, [...(grants.get(item.member_id) ?? []), item.capability]);
    }
    const members: HostedTeamMember[] = baseMembers.map((member) => ({ ...member,
      projectAccess: access.get(member.id) ?? null, extraCapabilities: grants.get(member.id) ?? [] }));
    return { workspaceId: row.id, name: row.name, projectId, coordinatorUrl,
      defaultMemberAccess: projectDefault?.access ?? 'edit', members };
  }

  async ownedWorkspaces(): Promise<OwnedTeamWorkspace[]> {
    const result: OwnedTeamWorkspace[] = [];
    for (const saved of await this.connections.list()) {
      if (saved.role !== 'owner' || teamCoordinatorTransport(saved.coordinatorUrl) !== 'loopback') continue;
      const connection = await this.ownerConnection(saved.workspaceId);
      const member = authenticateTeamMember(this.store.db, connection.credential);
      if (member.id !== saved.memberId || member.workspaceId !== saved.workspaceId) continue;
      const row = this.store.db.prepare(`SELECT workspace.name,
        (SELECT COUNT(*) FROM team_projects WHERE workspace_id = workspace.id) AS projectCount,
        (SELECT COUNT(*) FROM team_members WHERE workspace_id = workspace.id AND revoked_at IS NULL) AS memberCount
        FROM team_workspaces workspace WHERE workspace.id = ?`).get(saved.workspaceId) as
        { name: string; projectCount: number; memberCount: number } | undefined;
      if (row) result.push({ workspaceId: saved.workspaceId, ...row });
    }
    return result;
  }

  async addProject(projectId: string, workspaceId: string): Promise<HostedTeamWorkspace> {
    const owner = await this.ownerConnection(workspaceId);
    const member = authenticateTeamMember(this.store.db, owner.credential);
    if (member.id !== owner.memberId || member.workspaceId !== workspaceId) {
      throw new Error('Team workspace owner credential does not match this workspace.');
    }
    addTeamProject(this.store.db, owner.credential, projectId, true);
    return (await this.hostedProject(projectId))!;
  }

  async create(input: { projectId: string; workspaceName: string; ownerName: string }): Promise<HostedTeamWorkspace> {
    if (await this.hostedProject(input.projectId)) throw new Error('This project already belongs to a team workspace.');
    const coordinatorUrl = await this.start();
    const created = createTeamWorkspace(this.store.db, input);
    try {
      await this.connections.save({ workspaceId: created.workspaceId, memberId: created.owner.id,
        displayName: created.owner.displayName, role: 'owner', credential: created.credential, coordinatorUrl });
    } catch (error) {
      this.store.db.prepare('DELETE FROM team_workspaces WHERE id = ?').run(created.workspaceId);
      throw error;
    }
    return (await this.hostedProject(input.projectId))!;
  }

  async invite(projectId: string, role: Exclude<TeamRole, 'owner'>,
    transport: 'local' | 'tailnet' | 'lan' = 'local', lanOrigin?: string): Promise<{
    inviteSecret: string; coordinatorUrl: string; expiresAt: string;
  }> {
    if (transport !== 'local' && transport !== 'tailnet' && transport !== 'lan') throw new Error('Invalid team invitation transport.');
    const hosted = await this.hostedProject(projectId);
    if (!hosted) throw new Error('This project has no team workspace.');
    if (transport === 'tailnet' && !this.tailnetUrl) throw new Error('Enable Tailscale team access before inviting a peer.');
    const verifiedLanOrigin = transport === 'lan'
      ? await this.verifyLan(lanOrigin ?? '', hosted.coordinatorUrl) : null;
    const owner = await this.ownerConnection(hosted.workspaceId);
    const invitation = createTeamMemberInvite(this.store.db, owner.credential, hosted.workspaceId, role);
    return { inviteSecret: invitation.secret,
      coordinatorUrl: transport === 'tailnet' ? this.tailnetUrl! : verifiedLanOrigin ?? hosted.coordinatorUrl,
      expiresAt: invitation.expiresAt };
  }

  async tailnetStatus(projectId: string): Promise<TeamTailnetStatus> {
    await this.requireOwnerProject(projectId);
    return { enabled: !!this.tailnetUrl, coordinatorUrl: this.tailnetUrl };
  }

  async enableTailnet(projectId: string): Promise<TeamTailnetStatus> {
    const hosted = await this.hostedProject(projectId);
    if (!hosted) throw new Error('This project has no team workspace.');
    if (this.tailnetUrl) return { enabled: true, coordinatorUrl: this.tailnetUrl };
    if (!this.tailnetStarting) this.tailnetStarting = (async () => {
      const address = await this.tailnetAddress();
      const coordinator = new TeamCoordinatorHttp(this.store, this.agentStarter ?? undefined);
      const port = Number(new URL(hosted.coordinatorUrl).port);
      const url = await coordinator.start(port, address);
      this.tailnetCoordinator = coordinator;
      this.tailnetUrl = url;
      return url;
    })();
    try { await this.tailnetStarting; }
    finally { this.tailnetStarting = null; }
    return { enabled: true, coordinatorUrl: this.tailnetUrl };
  }

  async disableTailnet(projectId: string): Promise<TeamTailnetStatus> {
    await this.requireOwnerProject(projectId);
    await this.closeTailnet();
    return { enabled: false, coordinatorUrl: null };
  }

  private async requireOwnerProject(projectId: string): Promise<void> {
    const linked = this.store.db.prepare('SELECT workspace_id AS workspaceId FROM team_projects WHERE project_id = ?')
      .get(projectId) as { workspaceId: string } | undefined;
    if (!linked) throw new Error('This project has no team workspace.');
    const owner = await this.ownerConnection(linked.workspaceId);
    const member = authenticateTeamMember(this.store.db, owner.credential);
    if (member.id !== owner.memberId || member.workspaceId !== linked.workspaceId) {
      throw new Error('Team workspace owner credential does not match this workspace.');
    }
  }

  private async closeTailnet(): Promise<void> {
    await this.tailnetStarting?.catch(() => undefined);
    const active = this.tailnetCoordinator;
    this.tailnetCoordinator = null;
    this.tailnetUrl = null;
    await active?.close();
  }

  async revoke(projectId: string, memberId: string): Promise<HostedTeamWorkspace> {
    const hosted = await this.hostedProject(projectId);
    if (!hosted) throw new Error('This project has no team workspace.');
    const owner = await this.ownerConnection(hosted.workspaceId);
    revokeTeamMember(this.store.db, owner.credential, memberId);
    return (await this.hostedProject(projectId))!;
  }

  async setProjectAccess(projectId: string, memberId: string,
    access: 'none' | 'read' | 'edit' | null): Promise<HostedTeamWorkspace> {
    const hosted = await this.hostedProject(projectId);
    if (!hosted) throw new Error('This project has no team workspace.');
    const owner = await this.ownerConnection(hosted.workspaceId);
    setTeamProjectAccess(this.store.db, owner.credential, projectId, memberId, access);
    return (await this.hostedProject(projectId))!;
  }

  async setCapabilityGrant(projectId: string, memberId: string,
    capability: TeamCapability, grant: boolean): Promise<HostedTeamWorkspace> {
    const hosted = await this.hostedProject(projectId);
    if (!hosted) throw new Error('This project has no team workspace.');
    const owner = await this.ownerConnection(hosted.workspaceId);
    setTeamCapabilityGrant(this.store.db, owner.credential, projectId, memberId, capability, grant);
    return (await this.hostedProject(projectId))!;
  }

  async close(): Promise<void> {
    await this.closeTailnet();
    await this.starting?.catch(() => undefined);
    const active = this.coordinator;
    this.coordinator = null;
    this.url = null;
    await active?.close();
  }

  private async start(): Promise<string> {
    if (this.url) return this.url;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const saved = (await this.connections.list()).find((item) => item.role === 'owner' &&
        item.coordinatorUrl.startsWith('http://127.0.0.1:'));
      const port = saved ? Number(new URL(saved.coordinatorUrl).port) : 0;
      const coordinator = new TeamCoordinatorHttp(this.store, this.agentStarter ?? undefined);
      const url = await coordinator.start(port);
      this.coordinator = coordinator;
      this.url = url;
      return url;
    })();
    try { return await this.starting; }
    finally { this.starting = null; }
  }

  private async ownerConnection(workspaceId: string): Promise<SavedTeamConnection & { credential: string }> {
    const connection = await this.connections.get(workspaceId);
    if (!connection || connection.role !== 'owner' || teamCoordinatorTransport(connection.coordinatorUrl) !== 'loopback') {
      throw new Error('Local team workspace owner credential is unavailable.');
    }
    return connection;
  }
}
