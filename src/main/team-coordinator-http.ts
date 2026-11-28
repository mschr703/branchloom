import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StudioStore } from './store';
import type { CardPriority } from '../shared/types';
import { authenticateTeamMember, claimTeamMemberInvite, createTeamMemberInvite,
  claimTeamAgentLaunch, finishTeamAgentLaunch, requireTeamProjectCapability, revokeTeamMember,
  setTeamCardPriority, moveTeamCard, teamAgentLaunch, listTeamProjectMembers, changeTeamMemberRole,
  type TeamRole } from './team-workspace';
import { teamBoardSnapshot } from './team-board';
import { applyTeamCardDraftUpdate, readTeamCardDraft } from './team-card-draft';

const LOOPBACK = '127.0.0.1';
const MAX_BODY = 4_096;
type DraftSubscriber = { response: ServerResponse; credential: string; memberId: string;
  displayName: string; projectId: string; cardId: string };

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

function credential(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Unauthorized');
  return value.slice(7);
}

async function body(request: IncomingMessage, maxLength = MAX_BODY): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new Error('Invalid request body');
  }
  const parts: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += part.length;
    if (length > maxLength) throw new Error('Invalid request body');
    parts.push(part);
  }
  const value = JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request body');
  return value as Record<string, unknown>;
}

/** First coordinator transport slice. It intentionally accepts only loopback connections. */
export class TeamCoordinatorHttp {
  private server: Server | null = null;
  private readonly subscribers = new Set<DraftSubscriber>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly store: StudioStore,
    private readonly startAgent?: (cardId: string, agentId: string) => { id: string }) {}

  async start(preferredPort = 0): Promise<string> {
    if (this.server) throw new Error('Team coordinator is already running.');
    if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65535) throw new Error('Invalid coordinator port.');
    const server = createServer((request, response) => { void this.handle(request, response); });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(preferredPort, LOOPBACK, () => { server.off('error', reject); resolve(); });
      });
    } catch (error) { server.close(); throw error; }
    this.server = server;
    this.heartbeat = setInterval(() => this.refreshPresence(), 5_000);
    this.heartbeat.unref();
    return `http://${LOOPBACK}:${(server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const subscriber of this.subscribers) subscriber.response.end();
    this.subscribers.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      // Native clients call the coordinator from their main process. No browser origin is authorized here.
      if (request.headers.origin) return reply(response, 403, { error: 'Origin is not permitted' });
      const path = new URL(request.url ?? '/', `http://${LOOPBACK}`).pathname;
      if (request.method === 'POST' && path === '/v1/invitations/accept') {
        const value = await body(request);
        const member = claimTeamMemberInvite(this.store.db, { inviteSecret: value.secret as string,
          displayName: value.displayName as string, credential: value.credential as string,
          requestId: value.requestId as string });
        return reply(response, 201, { member });
      }
      const actorCredential = credential(request);
      if (request.method === 'POST' && path === '/v1/workspace/invitations') {
        const actor = authenticateTeamMember(this.store.db, actorCredential);
        const value = await body(request);
        const invite = createTeamMemberInvite(this.store.db, actorCredential, actor.workspaceId,
          value.role as Exclude<TeamRole, 'owner'>);
        return reply(response, 201, invite);
      }
      const memberRevoke = /^\/v1\/workspace\/members\/([0-9a-f-]{36})\/revoke$/.exec(path);
      if (request.method === 'POST' && memberRevoke) {
        revokeTeamMember(this.store.db, actorCredential, memberRevoke[1]!);
        for (const subscriber of this.subscribers) {
          if (subscriber.memberId === memberRevoke[1]) subscriber.response.end();
        }
        return reply(response, 200, { revoked: true });
      }
      const memberRole = /^\/v1\/workspace\/members\/([0-9a-f-]{36})\/role$/.exec(path);
      if (request.method === 'POST' && memberRole) {
        const value = await body(request);
        const changed = changeTeamMemberRole(this.store.db, {
          credential: actorCredential, memberId: memberRole[1]!, role: value.role as Exclude<TeamRole, 'owner'>,
          expectedRevision: value.expectedRevision as number, mutationId: value.mutationId as string,
        });
        reply(response, 200, changed);
        if (!changed.repeated) this.refreshPresence();
        return;
      }
      if (request.method === 'GET' && path === '/v1/workspace') {
        const actor = authenticateTeamMember(this.store.db, actorCredential);
        const projects = this.store.db.prepare(`SELECT project.id, project.name FROM team_projects linked
          JOIN projects project ON project.id = linked.project_id
          LEFT JOIN team_project_permissions permission ON permission.project_id = project.id AND permission.member_id = ?
          LEFT JOIN team_project_defaults defaults ON defaults.project_id = project.id
          WHERE linked.workspace_id = ? AND (? = 'owner' OR COALESCE(permission.access, defaults.access, 'edit') != 'none')
          ORDER BY project.name, project.id`).all(actor.id, actor.workspaceId, actor.role) as Array<{ id: string; name: string }>;
        return reply(response, 200, { member: actor, projects: projects.map((project) => {
          let canEditDraft = true;
          let canManageTask = true;
          try { requireTeamProjectCapability(this.store.db, actorCredential, project.id, 'edit_draft'); }
          catch { canEditDraft = false; }
          try { requireTeamProjectCapability(this.store.db, actorCredential, project.id, 'manage_task'); }
          catch { canManageTask = false; }
          return { ...project, canEditDraft, canManageTask };
        }) });
      }
      const projectMembers = /^\/v1\/projects\/([0-9a-f-]{36})\/members$/.exec(path);
      if (request.method === 'GET' && projectMembers) {
        return reply(response, 200, { members: listTeamProjectMembers(this.store.db, actorCredential, projectMembers[1]!) });
      }
      const board = /^\/v1\/projects\/([0-9a-f-]{36})\/board$/.exec(path);
      if (request.method === 'GET' && board) {
        const view = this.store.db.transaction(() => {
          requireTeamProjectCapability(this.store.db, actorCredential, board[1]!, 'read');
          const snapshot = teamBoardSnapshot(this.store, board[1]!);
          const rows = this.store.db.prepare(`SELECT id, content_revision FROM cards WHERE project_id = ? AND archived_at IS NULL
            ORDER BY column_id, position, id LIMIT ?`).all(board[1]!, snapshot.cards.length) as Array<{ id: string; content_revision: number }>;
          const revisions = new Map(rows.map((row) => [row.id, row.content_revision]));
          return { ...snapshot, cards: snapshot.cards.map((card) => ({ ...card, revision: revisions.get(card.id) ?? 0 })) };
        })();
        return reply(response, 200, view);
      }
      const draft = /^\/v1\/projects\/([0-9a-f-]{36})\/cards\/([0-9a-f-]{36})\/draft$/.exec(path);
      const draftEvents = /^\/v1\/projects\/([0-9a-f-]{36})\/cards\/([0-9a-f-]{36})\/draft\/events$/.exec(path);
      if (draftEvents && request.method === 'GET') {
        readTeamCardDraft(this.store.db, { credential: actorCredential,
          projectId: draftEvents[1]!, cardId: draftEvents[2]! });
        if (this.subscribers.size >= 100) return reply(response, 429, { error: 'Too many open team draft streams' });
        const actor = authenticateTeamMember(this.store.db, actorCredential);
        const subscriber: DraftSubscriber = { response, credential: actorCredential, memberId: actor.id,
          displayName: actor.displayName, projectId: draftEvents[1]!, cardId: draftEvents[2]! };
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
        this.subscribers.add(subscriber);
        response.on('close', () => { this.subscribers.delete(subscriber); this.refreshPresence(); });
        this.refreshPresence();
        return;
      }
      if (draft && request.method === 'GET') {
        return reply(response, 200, readTeamCardDraft(this.store.db, { credential: actorCredential,
          projectId: draft[1]!, cardId: draft[2]! }));
      }
      if (draft && request.method === 'POST') {
        const value = await body(request, 96 * 1024);
        const saved = applyTeamCardDraftUpdate(this.store.db, { credential: actorCredential,
          projectId: draft[1]!, cardId: draft[2]!, mutationId: value.mutationId as string,
          update: value.update as string });
        reply(response, 200, saved);
        if (!saved.repeated) this.broadcastDraft(draft[1]!, draft[2]!, saved.revision);
        return;
      }
      const priority = /^\/v1\/projects\/([0-9a-f-]{36})\/cards\/([0-9a-f-]{36})\/priority$/.exec(path);
      if (request.method === 'POST' && priority) {
        const value = await body(request);
        const result = setTeamCardPriority(this.store, { credential: actorCredential,
          projectId: priority[1]!, cardId: priority[2]!, priority: value.priority as CardPriority,
          expectedRevision: value.expectedRevision as number, mutationId: value.mutationId as string });
        reply(response, 200, result);
        if (!result.repeated) this.broadcastCard(priority[1]!, priority[2]!, result.revision);
        return;
      }
      const move = /^\/v1\/projects\/([0-9a-f-]{36})\/cards\/([0-9a-f-]{36})\/column$/.exec(path);
      if (request.method === 'POST' && move) {
        const value = await body(request);
        const result = moveTeamCard(this.store, { credential: actorCredential,
          projectId: move[1]!, cardId: move[2]!, columnId: value.columnId as string,
          expectedRevision: value.expectedRevision as number, mutationId: value.mutationId as string,
          agentStarterAvailable: Boolean(this.startAgent) });
        let launch = result.agentLaunch;
        if (!result.repeated && launch) {
          const actor = authenticateTeamMember(this.store.db, actorCredential);
          if (claimTeamAgentLaunch(this.store.db, actor.workspaceId, value.mutationId as string)) {
            let sessionId: string | null = null;
            try { sessionId = this.startAgent!(result.cardId, launch.agentId).id; }
            catch { /* The card move remains committed; the failed launch is explicit and not replayed. */ }
            finishTeamAgentLaunch(this.store.db, actor.workspaceId, value.mutationId as string, sessionId);
          }
          launch = teamAgentLaunch(this.store.db, actor.workspaceId, value.mutationId as string);
        }
        reply(response, 200, { ...result, agentLaunch: launch });
        if (!result.repeated) this.broadcastCard(move[1]!, move[2]!, result.revision);
        return;
      }
      reply(response, 404, { error: 'Route is unavailable' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Card changed. Reload before applying this team action.') {
        reply(response, 409, { error: 'Card changed. Reload before applying this team action.' });
      } else if (message === 'Team member role changed. Reload before applying this team action.') {
        reply(response, 409, { error: message });
      } else if (message === 'Team card is active. Pause the queue and finish its run before moving it.') {
        reply(response, 423, { error: message });
      } else if (message === 'Team agent worker is unavailable.') {
        reply(response, 503, { error: message });
      } else if (message === 'Unauthorized' || message === 'Team credential is unavailable.') {
        reply(response, 401, { error: 'Team credential is unavailable' });
      } else if (message.includes('not permitted') || message.includes('cannot invite') || message.includes('cannot be removed')) {
        reply(response, 403, { error: 'Team action is not permitted' });
      } else if (message === 'Invalid request body' || error instanceof SyntaxError ||
        message.startsWith('Invalid team card') || message.startsWith('Invalid team draft') ||
        message.startsWith('Invalid team role')) {
        reply(response, 400, { error: 'Invalid team command' });
      } else {
        reply(response, 400, { error: 'Team command was not accepted' });
      }
    }
  }

  private send(subscriber: DraftSubscriber, event: string, value: unknown): void {
    if (!subscriber.response.destroyed && !subscriber.response.writableEnded) {
      if (subscriber.response.writableLength > 64 * 1024) { subscriber.response.end(); return; }
      subscriber.response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    }
  }

  private matching(projectId: string, cardId: string): DraftSubscriber[] {
    return [...this.subscribers].filter((subscriber) => subscriber.projectId === projectId && subscriber.cardId === cardId);
  }

  private authorized(subscriber: DraftSubscriber): boolean {
    try {
      readTeamCardDraft(this.store.db, { credential: subscriber.credential,
        projectId: subscriber.projectId, cardId: subscriber.cardId });
      return true;
    } catch {
      subscriber.response.end();
      return false;
    }
  }

  private refreshPresence(): void {
    const targets = new Set([...this.subscribers].map((item) => `${item.projectId}:${item.cardId}`));
    for (const target of targets) {
      const [projectId, cardId] = target.split(':') as [string, string];
      const subscribers = this.matching(projectId, cardId).filter((item) => this.authorized(item));
      const members = [...new Map(subscribers.map((item) => [item.memberId,
        { memberId: item.memberId, displayName: item.displayName }])).values()];
      for (const subscriber of subscribers) this.send(subscriber, 'presence', { members });
    }
  }

  private broadcastDraft(projectId: string, cardId: string, revision: number): void {
    for (const subscriber of this.matching(projectId, cardId)) {
      if (this.authorized(subscriber)) this.send(subscriber, 'draft', { revision });
    }
  }

  private broadcastCard(projectId: string, cardId: string, revision: number): void {
    for (const subscriber of this.matching(projectId, cardId)) {
      if (this.authorized(subscriber)) this.send(subscriber, 'card', { revision });
    }
  }
}
