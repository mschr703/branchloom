import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StudioStore } from './store';
import { addTeamReviewComment, resolveTeamReviewInvite, teamReviewComments, teamReviewImage } from './team-review';
import { teamReviewCss, teamReviewHtml, teamReviewJs } from './team-review-page';

const TOKEN_PATH = /^\/(?:r|api\/r)\/([A-Za-z0-9_-]{43})(?:\/(image|comments))?$/;
const MAX_BODY_BYTES = 8 * 1024;

function respond(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  response.end(body);
}
const json = (response: ServerResponse, status: number, value: unknown) => respond(response, status, 'application/json; charset=utf-8', JSON.stringify(value));

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type'];
  if (contentType !== 'application/json') throw new Error('JSON content type is required.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Review request is too large.');
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Review request must be an object.');
  return value as Record<string, unknown>;
}

/** Binds to the supplied host; the caller must restrict non-loopback addresses and require an explicit sharing action. */
export class TeamReviewHttp {
  private server: Server | null = null;
  private address: string | null = null;
  private starting: Promise<string> | null = null;

  constructor(private readonly store: StudioStore, private readonly host = '127.0.0.1',
    private readonly allowedSecrets: Set<string> | null = null) {}

  allowSecret(secret: string): void {
    if (!this.allowedSecrets) throw new Error('This review listener does not use a secret allowlist.');
    this.allowedSecrets.add(secret);
  }

  async start(): Promise<string> {
    if (this.address) return this.address;
    if (this.starting) return this.starting;
    this.starting = this.listen();
    try { return await this.starting; }
    finally { this.starting = null; }
  }

  private async listen(): Promise<string> {
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) json(response, 400, { error: 'Invalid review request.' });
        else response.end();
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, this.host, () => { server.off('error', reject); resolve(); });
      });
      const port = (server.address() as AddressInfo).port;
      this.server = server;
      this.address = `http://${this.host}:${port}`;
      server.on('error', () => { this.server = null; this.address = null; });
      return this.address;
    } catch (error) {
      server.close();
      throw error;
    }
  }

  reviewUrl(secret: string): string {
    if (!this.address) throw new Error('Review listener is not running.');
    if (this.allowedSecrets && !this.allowedSecrets.has(secret)) throw new Error('Review invitation is unavailable on this listener.');
    return `${this.address}/r/${secret}`;
  }

  close(): void { this.server?.close(); this.server = null; this.address = null; }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.address) { json(response, 503, { error: 'Review listener is unavailable.' }); return; }
    const expectedHost = new URL(this.address).host;
    if (request.headers.host !== expectedHost) { json(response, 421, { error: 'Unexpected review host.' }); return; }
    const path = new URL(request.url ?? '/', this.address).pathname;
    if (request.method === 'GET' && path === '/team-review.css') { respond(response, 200, 'text/css; charset=utf-8', teamReviewCss); return; }
    if (request.method === 'GET' && path === '/team-review.js') { respond(response, 200, 'text/javascript; charset=utf-8', teamReviewJs); return; }
    const match = TOKEN_PATH.exec(path);
    if (!match) { json(response, 404, { error: 'Review page not found.' }); return; }
    const secret = match[1]!;
    if (this.allowedSecrets && !this.allowedSecrets.has(secret)) { json(response, 403, { error: 'Review invitation is unavailable.' }); return; }
    let access: ReturnType<typeof resolveTeamReviewInvite>;
    try { access = resolveTeamReviewInvite(this.store, secret); }
    catch { json(response, 403, { error: 'Review invitation is unavailable.' }); return; }
    const isPage = path.startsWith('/r/');
    if (isPage && request.method === 'GET' && !match[2]) { respond(response, 200, 'text/html; charset=utf-8', teamReviewHtml); return; }
    if (path.startsWith('/api/r/') && request.method === 'GET' && match[2] === 'image') {
      try { respond(response, 200, 'image/png', teamReviewImage(this.store, access.room.id)); }
      catch { json(response, 500, { error: 'Review image is unavailable.' }); }
      return;
    }
    if (path.startsWith('/api/r/') && request.method === 'GET' && (!match[2] || match[2] === 'comments')) {
      json(response, 200, match[2] === 'comments' ? { comments: teamReviewComments(this.store, access.room.id) }
        : { room: access.room, comments: teamReviewComments(this.store, access.room.id) });
      return;
    }
    if (path.startsWith('/api/r/') && request.method === 'POST' && match[2] === 'comments') {
      if (request.headers.origin !== this.address) { json(response, 403, { error: 'Review origin is not allowed.' }); return; }
      try {
        const body = await readJson(request);
        const comment = addTeamReviewComment(this.store, { reviewerSecret: secret,
          clientMutationId: body.clientMutationId as string, body: body.body as string, x: body.x as number, y: body.y as number });
        json(response, 200, { comment });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Review request failed.';
        const conflict = message.includes('already used');
        const oversized = message.includes('too large');
        const closed = message.includes('closed');
        const invalid = message.includes('invalid') || message.includes('required') || message.includes('must be');
        json(response, conflict ? 409 : oversized ? 413 : closed ? 403 : 400,
          { error: conflict || oversized || closed || invalid ? message : 'Review request failed.' });
      }
      return;
    }
    json(response, 403, { error: 'This invitation allows review comments only.' });
  }
}
