import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StudioStore } from './store';
import { addTeamBoardComment, resolveTeamBoardInvite, teamBoardSnapshot } from './team-board';
import { teamBoardCss, teamBoardHtml, teamBoardJs } from './team-board-page';

const PAGE = /^\/board\/([A-Za-z0-9_-]{43})(?:\/(style\.css|app\.js))?$/;
const DATA = /^\/api\/board\/([A-Za-z0-9_-]{43})(?:\/(comments))?$/;
const MAX_BODY_BYTES = 4 * 1024;

function respond(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  response.end(body);
}
const json = (response: ServerResponse, status: number, value: unknown) =>
  respond(response, status, 'application/json; charset=utf-8', JSON.stringify(value));

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type'] !== 'application/json') throw new Error('JSON content type is required.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Board request is too large.');
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Board request must be an object.');
  return value as Record<string, unknown>;
}

/** Explicitly started board listener with an in-memory allowlist and per-invite comment checks. */
export class TeamBoardHttp {
  private server: Server | null = null;
  private address: string | null = null;
  private starting: Promise<string> | null = null;
  private readonly allowedSecrets = new Set<string>();
  constructor(private readonly store: StudioStore, private readonly host = '127.0.0.1') {}

  allowSecret(secret: string): void { this.allowedSecrets.add(secret); }
  url(secret: string): string {
    if (!this.address || !this.allowedSecrets.has(secret)) throw new Error('Board invitation is unavailable on this listener.');
    resolveTeamBoardInvite(this.store, secret);
    return `${this.address}/board/${secret}`;
  }
  async start(): Promise<string> {
    if (this.address) return this.address;
    if (this.starting) return this.starting;
    this.starting = this.listen();
    try { return await this.starting; } finally { this.starting = null; }
  }
  private async listen(): Promise<string> {
    const server = createServer((request, response) => { void (async () => {
      if (!this.address) { json(response, 503, { error: 'Board listener is unavailable.' }); return; }
      if (request.headers.host !== new URL(this.address).host) { json(response, 421, { error: 'Unexpected host.' }); return; }
      const path = new URL(request.url ?? '/', this.address).pathname;
      const page = PAGE.exec(path);
      const data = DATA.exec(path);
      if (!page && !data) { json(response, 404, { error: 'Board view not found.' }); return; }
      const secret = (page ?? data)![1]!;
      if (!this.allowedSecrets.has(secret)) { json(response, 403, { error: 'Board invitation is unavailable.' }); return; }
      let invite: ReturnType<typeof resolveTeamBoardInvite>;
      try { invite = resolveTeamBoardInvite(this.store, secret); }
      catch { json(response, 403, { error: 'Board invitation is unavailable.' }); return; }
      if (data?.[2] === 'comments' && request.method === 'POST') {
        if (!invite.canComment) { json(response, 403, { error: 'This invitation cannot comment.' }); return; }
        if (request.headers.origin !== this.address) { json(response, 403, { error: 'Board origin is not allowed.' }); return; }
        try {
          const body = await readJson(request);
          const comment = addTeamBoardComment(this.store, { secret, cardId: body.cardId as string,
            body: body.body as string, clientMutationId: body.clientMutationId as string });
          json(response, 200, { comment: { id: comment.id, cardId: comment.cardId, createdAt: comment.createdAt } });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Board comment failed.';
          const conflict = message.includes('already used');
          const oversized = message.includes('too large');
          const denied = message.includes('invitation is unavailable') || message.includes('cannot comment');
          const missingCard = message.includes('card is unavailable');
          json(response, conflict ? 409 : oversized ? 413 : denied ? 403 : missingCard ? 404 : 400,
            { error: conflict || oversized || denied || message.includes('invalid') ? message : 'Board comment failed.' });
        }
        return;
      }
      if (request.method !== 'GET') { json(response, 405, { error: 'This invitation is read-only.' }); return; }
      if (data?.[2]) { json(response, 405, { error: 'Comments require an explicit send.' }); return; }
      if (data) { json(response, 200, { ...teamBoardSnapshot(this.store, invite.projectId), canComment: invite.canComment }); return; }
      if (page![2] === 'style.css') { respond(response, 200, 'text/css; charset=utf-8', teamBoardCss); return; }
      if (page![2] === 'app.js') { respond(response, 200, 'text/javascript; charset=utf-8', teamBoardJs); return; }
      respond(response, 200, 'text/html; charset=utf-8', teamBoardHtml.replaceAll('__BOARD_PATH__', `/board/${secret}`));
    })().catch(() => { if (!response.headersSent) json(response, 500, { error: 'Board request failed.' }); else response.end(); }); });
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject);
        server.listen(0, this.host, () => { server.off('error', reject); resolve(); }); });
      this.server = server;
      this.address = `http://${this.host}:${(server.address() as AddressInfo).port}`;
      server.on('error', () => { this.server = null; this.address = null; });
      return this.address;
    } catch (error) { server.close(); throw error; }
  }
  close(): void { this.server?.close(); this.server = null; this.address = null; this.allowedSecrets.clear(); }
}
