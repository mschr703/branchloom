import type { StudioStore } from './store';
import { TeamConnectionStore, type SavedTeamConnection } from './team-connection-store';
import { TeamCoordinatorHttp } from './team-coordinator-http';
import { authenticateTeamMember, createTeamMemberInvite, createTeamWorkspace, revokeTeamMember,
  setTeamCapabilityGrant, setTeamProjectAccess, type TeamCapability, type TeamMember, type TeamRole } from './team-workspace';

export interface HostedTeamMember extends TeamMember {
  projectAccess: 'none' | 'read' | 'edit' | null;
  extraCapabilities: TeamCapability[];
}

export interface HostedTeamWorkspace {
  workspaceId: string;
  name: string;
  projectId: string;
  coordinatorUrl: string;
  members: HostedTeamMember[];
}

/** The first host transport stays on loopback and reuses its saved port after restart. */
export class TeamLocalService {
  private coordinator: TeamCoordinatorHttp | null = null;
  private url: string | null = null;
  private starting: Promise<string> | null = null;

  constructor(private readonly store: StudioStore, private readonly connections: TeamConnectionStore) {}

  /** Restore the local coordinator after app restart without waiting for the Team page. */
  async resumeSavedHost(): Promise<string | null> {
    const owner = (await this.connections.list()).find((item) => item.role === 'owner' &&
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
    if (!connection || connection.role !== 'owner' ||
      authenticateTeamMember(this.store.db, connection.credential).id !== connection.memberId) {
      throw new Error('This device does not hold the team workspace owner credential.');
    }
    const coordinatorUrl = await this.start();
    if (connection.coordinatorUrl !== coordinatorUrl) await this.connections.save({ ...connection, coordinatorUrl });
    const baseMembers = this.store.db.prepare(`SELECT id, workspace_id AS workspaceId, display_name AS displayName,
      role, revoked_at AS revokedAt FROM team_members WHERE workspace_id = ? ORDER BY created_at, id`)
      .all(row.id) as TeamMember[];
    const access = new Map((this.store.db.prepare('SELECT member_id, access FROM team_project_permissions WHERE project_id = ?')
      .all(projectId) as Array<{ member_id: string; access: 'none' | 'read' | 'edit' }>).map((item) => [item.member_id, item.access]));
    const grants = new Map<string, TeamCapability[]>();
    for (const item of this.store.db.prepare('SELECT member_id, capability FROM team_project_capability_grants WHERE project_id = ?')
      .all(projectId) as Array<{ member_id: string; capability: TeamCapability }>) {
      grants.set(item.member_id, [...(grants.get(item.member_id) ?? []), item.capability]);
    }
    const members: HostedTeamMember[] = baseMembers.map((member) => ({ ...member,
      projectAccess: access.get(member.id) ?? null, extraCapabilities: grants.get(member.id) ?? [] }));
    return { workspaceId: row.id, name: row.name, projectId, coordinatorUrl, members };
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

  async invite(projectId: string, role: Exclude<TeamRole, 'owner'>): Promise<{
    inviteSecret: string; coordinatorUrl: string; expiresAt: string;
  }> {
    const hosted = await this.hostedProject(projectId);
    if (!hosted) throw new Error('This project has no team workspace.');
    const owner = await this.ownerConnection(hosted.workspaceId);
    const invitation = createTeamMemberInvite(this.store.db, owner.credential, hosted.workspaceId, role);
    return { inviteSecret: invitation.secret, coordinatorUrl: hosted.coordinatorUrl, expiresAt: invitation.expiresAt };
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
      const coordinator = new TeamCoordinatorHttp(this.store);
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
    if (!connection || connection.role !== 'owner') throw new Error('Team workspace owner credential is unavailable.');
    return connection;
  }
}
