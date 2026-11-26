import type { SavedTeamConnection } from './team-connection-store';
import { TeamConnectionStore } from './team-connection-store';
import { TeamJoinAttemptStore } from './team-join-attempt';
import type { TeamMember, TeamRole } from './team-workspace';
import type { TeamCardDraft } from './team-card-draft';
import { TeamDraftOutboxStore, type PendingTeamDraftUpdate } from './team-draft-outbox';
import type { TeamBoardSnapshot } from '../shared/team-board';
import type { CardPriority } from '../shared/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES: readonly TeamRole[] = ['owner', 'admin', 'editor', 'developer', 'viewer'];
const MAX_RESPONSE = 768 * 1024;
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];

export interface CollaborativeTeamBoard extends Omit<TeamBoardSnapshot, 'cards'> {
  cards: Array<TeamBoardSnapshot['cards'][number] & { revision: number }>;
}

export type TeamDraftStreamEvent =
  | { type: 'presence'; members: Array<{ memberId: string; displayName: string }> }
  | { type: 'draft'; revision: number };

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

function checkedDraft(value: unknown, projectId: string, cardId: string): TeamCardDraft {
  const item = record(value);
  if (!item || item.projectId !== projectId || item.cardId !== cardId ||
    typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 0 ||
    typeof item.update !== 'string' || item.update.length > 700_000 ||
    (item.update && Buffer.from(item.update, 'base64').toString('base64') !== item.update) ||
    (item.updatedAt !== null && (typeof item.updatedAt !== 'string' || Number.isNaN(Date.parse(item.updatedAt))))) {
    throw new Error('Coordinator returned an invalid card draft.');
  }
  return { projectId, cardId, revision: item.revision, update: item.update, updatedAt: item.updatedAt as string | null };
}

function checkedBoard(value: unknown): CollaborativeTeamBoard {
  const item = record(value);
  if (!item || typeof item.projectName !== 'string' || item.projectName.length > 200 ||
    typeof item.observedAt !== 'string' || Number.isNaN(Date.parse(item.observedAt)) ||
    !['off', 'running', 'paused'].includes(String(item.queueState)) || typeof item.truncated !== 'boolean' ||
    !Array.isArray(item.columns) || item.columns.length > 50 || !Array.isArray(item.cards) || item.cards.length > 200) {
    throw new Error('Coordinator returned an invalid team board.');
  }
  const columns = item.columns.map((raw) => {
    const column = record(raw);
    if (!column || typeof column.id !== 'string' || !UUID.test(column.id) ||
      typeof column.name !== 'string' || column.name.length > 200) throw new Error('Coordinator returned an invalid team board.');
    return { id: column.id, name: column.name };
  });
  const columnIds = new Set(columns.map((column) => column.id));
  const cards = item.cards.map((raw) => {
    const card = record(raw);
    if (!card || typeof card.id !== 'string' || !UUID.test(card.id) || typeof card.columnId !== 'string' ||
      !columnIds.has(card.columnId) || typeof card.title !== 'string' || card.title.length > 200 ||
      typeof card.priority !== 'string' || !PRIORITIES.includes(card.priority) ||
      (card.runningSince !== null && (typeof card.runningSince !== 'string' || Number.isNaN(Date.parse(card.runningSince)))) ||
      typeof card.revision !== 'number' || !Number.isSafeInteger(card.revision) || card.revision < 0) {
      throw new Error('Coordinator returned an invalid team board.');
    }
    return { id: card.id, columnId: card.columnId, title: card.title,
      priority: card.priority as TeamBoardSnapshot['cards'][number]['priority'],
      runningSince: card.runningSince as string | null, revision: card.revision };
  });
  return { projectName: item.projectName, observedAt: item.observedAt, columns, cards,
    queueState: item.queueState as TeamBoardSnapshot['queueState'], truncated: item.truncated };
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
    private readonly attempts: TeamJoinAttemptStore, private readonly request: typeof fetch = fetch,
    private readonly outbox?: TeamDraftOutboxStore) {}

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

  async workspace(workspaceId: string): Promise<{ member: TeamMember; projects: Array<{ id: string; name: string; canEditDraft: boolean; canManageTask: boolean }> }> {
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
        typeof project.name !== 'string' || project.name.length > 200 || typeof project.canEditDraft !== 'boolean' ||
        typeof project.canManageTask !== 'boolean') {
        throw new Error('Coordinator returned an invalid project.');
      }
      return { id: project.id, name: project.name, canEditDraft: project.canEditDraft,
        canManageTask: project.canManageTask };
    });
    return { member, projects };
  }

  async cardDraft(input: { workspaceId: string; projectId: string; cardId: string }): Promise<TeamCardDraft> {
    if (!UUID.test(input.projectId) || !UUID.test(input.cardId)) throw new Error('Invalid team draft target.');
    return checkedDraft(await this.authenticated(input.workspaceId,
      `/v1/projects/${input.projectId}/cards/${input.cardId}/draft`), input.projectId, input.cardId);
  }

  async board(input: { workspaceId: string; projectId: string }): Promise<CollaborativeTeamBoard> {
    if (!UUID.test(input.projectId)) throw new Error('Invalid team project.');
    return checkedBoard(await this.authenticated(input.workspaceId, `/v1/projects/${input.projectId}/board`));
  }

  async setCardPriority(input: { workspaceId: string; projectId: string; cardId: string;
    priority: CardPriority; expectedRevision: number; mutationId: string }): Promise<{
    cardId: string; revision: number; priority: CardPriority; repeated: boolean;
  }> {
    if (!UUID.test(input.projectId) || !UUID.test(input.cardId) || !UUID.test(input.mutationId) ||
      !PRIORITIES.includes(input.priority) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error('Invalid team card priority command.');
    }
    const value = record(await this.authenticated(input.workspaceId,
      `/v1/projects/${input.projectId}/cards/${input.cardId}/priority`, {
        priority: input.priority, expectedRevision: input.expectedRevision, mutationId: input.mutationId,
      }));
    if (!value || value.cardId !== input.cardId || value.priority !== input.priority ||
      !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || typeof value.repeated !== 'boolean') {
      throw new Error('Coordinator returned an invalid card priority result.');
    }
    return { cardId: input.cardId, revision: value.revision as number, priority: input.priority, repeated: value.repeated };
  }

  async moveCard(input: { workspaceId: string; projectId: string; cardId: string;
    columnId: string; expectedRevision: number; mutationId: string }): Promise<{
    cardId: string; columnId: string; revision: number; repeated: boolean;
  }> {
    if (!UUID.test(input.projectId) || !UUID.test(input.cardId) || !UUID.test(input.columnId) ||
      !UUID.test(input.mutationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error('Invalid team card move command.');
    }
    const value = record(await this.authenticated(input.workspaceId,
      `/v1/projects/${input.projectId}/cards/${input.cardId}/column`, {
        columnId: input.columnId, expectedRevision: input.expectedRevision, mutationId: input.mutationId,
      }));
    if (!value || value.cardId !== input.cardId || value.columnId !== input.columnId ||
      !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || typeof value.repeated !== 'boolean') {
      throw new Error('Coordinator returned an invalid card move result.');
    }
    return { cardId: input.cardId, columnId: input.columnId, revision: value.revision as number, repeated: value.repeated };
  }

  async updateCardDraft(input: { workspaceId: string; projectId: string; cardId: string;
    mutationId: string; update: string }): Promise<TeamCardDraft & { repeated: boolean }> {
    if (!UUID.test(input.projectId) || !UUID.test(input.cardId) || !UUID.test(input.mutationId) ||
      typeof input.update !== 'string' || input.update.length > 90_000) throw new Error('Invalid team draft update.');
    await this.outbox?.enqueue(input);
    const value = record(await this.authenticated(input.workspaceId,
      `/v1/projects/${input.projectId}/cards/${input.cardId}/draft`,
      { mutationId: input.mutationId, update: input.update }));
    if (typeof value?.repeated !== 'boolean') throw new Error('Coordinator returned an invalid card draft.');
    const checked = checkedDraft(value, input.projectId, input.cardId);
    await this.outbox?.acknowledge(input.mutationId);
    return { ...checked, repeated: value.repeated };
  }

  async pendingCardDraftUpdates(input: { workspaceId: string; projectId: string; cardId: string }): Promise<PendingTeamDraftUpdate[]> {
    return this.outbox?.list(input) ?? [];
  }

  async resumeCardDraftUpdates(input: { workspaceId: string; projectId: string; cardId: string }): Promise<number> {
    const pending = await this.outbox?.list(input) ?? [];
    for (const update of pending) await this.updateCardDraft(update);
    return pending.length;
  }

  /** Authenticated event stream; credentials stay in the main process and never enter a URL. */
  async streamCardDraft(input: { workspaceId: string; projectId: string; cardId: string },
    onEvent: (event: TeamDraftStreamEvent) => void, signal: AbortSignal): Promise<void> {
    if (!UUID.test(input.projectId) || !UUID.test(input.cardId)) throw new Error('Invalid team draft target.');
    const connection = await this.connections.get(input.workspaceId);
    if (!connection) throw new Error('This team workspace is not saved on this device.');
    const idle = new AbortController();
    let idleTimer = setTimeout(() => idle.abort(), 15_000);
    const activeSignal = AbortSignal.any([signal, idle.signal]);
    const refreshIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => idle.abort(), 15_000); };
    let response: Response;
    try {
      response = await this.request(`${connection.coordinatorUrl}/v1/projects/${input.projectId}/cards/${input.cardId}/draft/events`, {
        headers: { Authorization: `Bearer ${connection.credential}` }, redirect: 'error', signal: activeSignal,
      });
    } catch (error) {
      clearTimeout(idleTimer);
      if (signal.aborted) return;
      throw new Error('Coordinator event stream is unavailable.', { cause: error });
    }
    if (response.status === 401 || response.status === 403) {
      clearTimeout(idleTimer);
      throw new Error('Team access was revoked or is unavailable.');
    }
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
      clearTimeout(idleTimer);
      throw new Error('Coordinator returned an invalid event stream.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      while (!signal.aborted) {
        const item = await reader.read();
        if (item.done) break;
        refreshIdle();
        buffered += decoder.decode(item.value, { stream: true });
        if (buffered.length > 32_000) throw new Error('Coordinator event is too large.');
        let boundary = buffered.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          const type = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (type && data) {
            let value: unknown;
            try { value = JSON.parse(data) as unknown; } catch { throw new Error('Coordinator event is invalid.'); }
            const body = record(value);
            if (type === 'draft') {
              if (!body || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) {
                throw new Error('Coordinator event is invalid.');
              }
              onEvent({ type: 'draft', revision: body.revision as number });
            } else if (type === 'presence') {
              if (!body || !Array.isArray(body.members) || body.members.length > 100) {
                throw new Error('Coordinator event is invalid.');
              }
              const members = body.members.map((item) => {
                const member = record(item);
                if (!member || typeof member.memberId !== 'string' || !UUID.test(member.memberId) ||
                  typeof member.displayName !== 'string' || !member.displayName.trim() || member.displayName.length > 80) {
                  throw new Error('Coordinator event is invalid.');
                }
                return { memberId: member.memberId, displayName: member.displayName };
              });
              onEvent({ type: 'presence', members });
            }
          }
          boundary = buffered.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally { clearTimeout(idleTimer); await reader.cancel().catch(() => undefined); }
    if (!signal.aborted) throw new Error('Coordinator event stream closed.');
  }

  private async authenticated(workspaceId: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
    const connection = await this.connections.get(workspaceId);
    if (!connection) throw new Error('This team workspace is not saved on this device.');
    let response: Response;
    try {
      response = await this.request(`${connection.coordinatorUrl}${path}`, {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${connection.credential}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Coordinator is unavailable.'); }
    if (response.status === 401 || response.status === 403) throw new Error('Team access was revoked or is unavailable.');
    if (response.status === 409) throw new Error('Team card changed. Reload before retrying.');
    if (response.status === 423) throw new Error('Pause the project queue and finish the active run before moving this card.');
    if (!response.ok) throw new Error(`Coordinator request failed (HTTP ${response.status}).`);
    return limitedJson(response);
  }
}
