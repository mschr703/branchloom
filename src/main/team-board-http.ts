import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StudioStore } from './store';
import { resolveTeamBoardInvite, teamBoardSnapshot } from './team-board';
import { teamBoardCss, teamBoardHtml, teamBoardJs } from './team-board-page';

const PAGE = /^\/board\/([A-Za-z0-9_-]{43})(?:\/(style\.css|app\.js))?$/;
const DATA = /^\/api\/board\/([A-Za-z0-9_-]{43})$/;

function respond(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  response.end(body);
}
const json = (response: ServerResponse, status: number, value: unknown) =>
  respond(response, status, 'application/json; charset=utf-8', JSON.stringify(value));

/** Explicitly started, read-only listener with an allowlist for this app run. */
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
    const server = createServer((request, response) => {
      if (!this.address) { json(response, 503, { error: 'Board listener is unavailable.' }); return; }
      if (request.headers.host !== new URL(this.address).host) { json(response, 421, { error: 'Unexpected host.' }); return; }
      const path = new URL(request.url ?? '/', this.address).pathname;
      const page = PAGE.exec(path);
      const data = DATA.exec(path);
      if (!page && !data) { json(response, 404, { error: 'Board view not found.' }); return; }
      const secret = (page ?? data)![1]!;
      if (!this.allowedSecrets.has(secret)) { json(response, 403, { error: 'Board invitation is unavailable.' }); return; }
      let projectId: string;
      try { projectId = resolveTeamBoardInvite(this.store, secret).projectId; }
      catch { json(response, 403, { error: 'Board invitation is unavailable.' }); return; }
      if (request.method !== 'GET') { json(response, 405, { error: 'This invitation is read-only.' }); return; }
      if (data) { json(response, 200, teamBoardSnapshot(this.store, projectId)); return; }
      if (page![2] === 'style.css') { respond(response, 200, 'text/css; charset=utf-8', teamBoardCss); return; }
      if (page![2] === 'app.js') { respond(response, 200, 'text/javascript; charset=utf-8', teamBoardJs); return; }
      respond(response, 200, 'text/html; charset=utf-8', teamBoardHtml.replaceAll('__BOARD_PATH__', `/board/${secret}`));
    });
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
