import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StudioStore } from './store';
import type { CardPriority } from '../shared/types';
import { authenticateTeamMember, requireTeamProjectCapability, setTeamCardPriority } from './team-workspace';
import { teamBoardSnapshot } from './team-board';

const LOOPBACK = '127.0.0.1';
const MAX_BODY = 4_096;

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

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new Error('Invalid request body');
  }
  const parts: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += part.length;
    if (length > MAX_BODY) throw new Error('Invalid request body');
    parts.push(part);
  }
  const value = JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request body');
  return value as Record<string, unknown>;
}

/** First coordinator transport slice. It intentionally accepts only loopback connections. */
export class TeamCoordinatorHttp {
  private server: Server | null = null;

  constructor(private readonly store: StudioStore) {}

  async start(): Promise<string> {
    if (this.server) throw new Error('Team coordinator is already running.');
    const server = createServer((request, response) => { void this.handle(request, response); });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, LOOPBACK, () => { server.off('error', reject); resolve(); });
      });
    } catch (error) { server.close(); throw error; }
    this.server = server;
    return `http://${LOOPBACK}:${(server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      // Native clients call the coordinator from their main process. No browser origin is authorized here.
      if (request.headers.origin) return reply(response, 403, { error: 'Origin is not permitted' });
      const path = new URL(request.url ?? '/', `http://${LOOPBACK}`).pathname;
      const actorCredential = credential(request);
      if (request.method === 'GET' && path === '/v1/workspace') {
        const actor = authenticateTeamMember(this.store.db, actorCredential);
        const projects = this.store.db.prepare(`SELECT project.id, project.name FROM team_projects linked
          JOIN projects project ON project.id = linked.project_id WHERE linked.workspace_id = ? ORDER BY project.name, project.id`)
          .all(actor.workspaceId) as Array<{ id: string; name: string }>;
        const visible = projects.filter((project) => {
          try { requireTeamProjectCapability(this.store.db, actorCredential, project.id, 'read'); return true; }
          catch { return false; }
        });
        return reply(response, 200, { member: actor, projects: visible });
      }
      const board = /^\/v1\/projects\/([0-9a-f-]{36})\/board$/.exec(path);
      if (request.method === 'GET' && board) {
        requireTeamProjectCapability(this.store.db, actorCredential, board[1]!, 'read');
        return reply(response, 200, teamBoardSnapshot(this.store, board[1]!));
      }
      const priority = /^\/v1\/projects\/([0-9a-f-]{36})\/cards\/([0-9a-f-]{36})\/priority$/.exec(path);
      if (request.method === 'POST' && priority) {
        const value = await body(request);
        const result = setTeamCardPriority(this.store, { credential: actorCredential,
          projectId: priority[1]!, cardId: priority[2]!, priority: value.priority as CardPriority,
          expectedRevision: value.expectedRevision as number, mutationId: value.mutationId as string });
        return reply(response, 200, result);
      }
      reply(response, 404, { error: 'Route is unavailable' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Card changed. Reload before applying this team action.') {
        reply(response, 409, { error: 'Card changed. Reload before applying this team action.' });
      } else if (message === 'Unauthorized' || message === 'Team credential is unavailable.') {
        reply(response, 401, { error: 'Team credential is unavailable' });
      } else if (message.includes('not permitted')) {
        reply(response, 403, { error: 'Team action is not permitted' });
      } else if (message === 'Invalid request body' || error instanceof SyntaxError || message.startsWith('Invalid team card')) {
        reply(response, 400, { error: 'Invalid team command' });
      } else {
        reply(response, 400, { error: 'Team command was not accepted' });
      }
    }
  }
}
