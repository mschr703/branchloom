import type { SavedTeamConnection } from './team-connection-store';
import { TeamConnectionStore } from './team-connection-store';
import { TeamJoinAttemptStore } from './team-join-attempt';
import type { TeamMember, TeamRole } from './team-workspace';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES: readonly TeamRole[] = ['owner', 'admin', 'editor', 'developer', 'viewer'];
const MAX_RESPONSE = 256 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function checkedMember(value: unknown): TeamMember {
  const item = record(value);
  if (!item || typeof item.id !== 'string' || !UUID.test(item.id) ||
    typeof item.workspaceId !== 'string' || !UUID.test(item.workspaceId) ||
    typeof item.displayName !== 'string' || !item.displayName.trim() || item.displayName.length > 80 ||
    typeof item.role !== 'string' || !ROLES.includes(item.role as TeamRole) || item.revokedAt !== null) {
    throw new Error('Coordinator returned an invalid team member.');
  }
  return { id: item.id, workspaceId: item.workspaceId, displayName: item.displayName,
    role: item.role as TeamRole, revokedAt: null };
}

async function limitedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Coordinator returned no response.');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > MAX_RESPONSE) { await reader.cancel(); throw new Error('Coordinator response is too large.'); }
    parts.push(item.value);
  }
  const raw = Buffer.concat(parts).toString('utf8');
  try { return JSON.parse(raw) as unknown; }
  catch { throw new Error('Coordinator returned invalid JSON.'); }
}

/** Network calls never follow redirects with a member credential. Pending joins survive uncertain replies. */
export class TeamRemoteClient {
  constructor(private readonly connections: TeamConnectionStore,
    private readonly attempts: TeamJoinAttemptStore, private readonly request: typeof fetch = fetch) {}

  async beginJoin(input: { coordinatorUrl: string; inviteSecret: string; displayName: string }): Promise<SavedTeamConnection> {
    await this.attempts.prepare(input);
    return this.resumeJoin();
  }

  async resumeJoin(): Promise<SavedTeamConnection> {
    const pending = await this.attempts.load();
    if (!pending) throw new Error('No team invitation is waiting to be resumed.');
    let response: Response;
    try {
      response = await this.request(`${pending.coordinatorUrl}/v1/invitations/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ secret: pending.inviteSecret, displayName: pending.displayName,
          credential: pending.credential, requestId: pending.requestId }),
      });
    } catch { throw new Error('Coordinator is unavailable. Retry the saved invitation when connected.'); }
    if (!response.ok) throw new Error(`Coordinator rejected the invitation (HTTP ${response.status}).`);
    const value = record(await limitedJson(response));
    const member = checkedMember(value?.member);
    const existing = await this.connections.get(member.workspaceId);
    if (existing && existing.memberId !== member.id) throw new Error('This device already has another member for this workspace.');
    const saved = await this.connections.save({ workspaceId: member.workspaceId, memberId: member.id,
      displayName: member.displayName, role: member.role, coordinatorUrl: pending.coordinatorUrl,
      credential: pending.credential });
    await this.attempts.clear(pending.requestId);
    return saved;
  }

  async cancelPendingJoin(): Promise<void> {
    const pending = await this.attempts.load();
    if (pending) await this.attempts.clear(pending.requestId);
  }

  async pendingJoin(): Promise<{ coordinatorUrl: string; displayName: string } | null> {
    const pending = await this.attempts.load();
    return pending ? { coordinatorUrl: pending.coordinatorUrl, displayName: pending.displayName } : null;
  }

  async workspace(workspaceId: string): Promise<{ member: TeamMember; projects: Array<{ id: string; name: string }> }> {
    const connection = await this.connections.get(workspaceId);
    if (!connection) throw new Error('This team workspace is not saved on this device.');
    let response: Response;
    try {
      response = await this.request(`${connection.coordinatorUrl}/v1/workspace`, { method: 'GET',
        headers: { Authorization: `Bearer ${connection.credential}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch { throw new Error('Coordinator is unavailable.'); }
    if (response.status === 401 || response.status === 403) throw new Error('Team access was revoked or is unavailable.');
    if (!response.ok) throw new Error(`Coordinator request failed (HTTP ${response.status}).`);
    const value = record(await limitedJson(response));
    const member = checkedMember(value?.member);
    if (member.workspaceId !== workspaceId || member.id !== connection.memberId || !Array.isArray(value?.projects) ||
      value.projects.length > 500) throw new Error('Coordinator returned an invalid workspace.');
    const projects = value.projects.map((item) => {
      const project = record(item);
      if (!project || typeof project.id !== 'string' || !UUID.test(project.id) ||
        typeof project.name !== 'string' || project.name.length > 200) throw new Error('Coordinator returned an invalid project.');
      return { id: project.id, name: project.name };
    });
    return { member, projects };
  }
}
