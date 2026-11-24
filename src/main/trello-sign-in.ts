import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TrelloConnectionStatus } from '../shared/types';
import { TrelloConnection } from './trello-connection';

const API_KEY = /^[a-z0-9]{16,128}$/i;
const API_TOKEN = /^[a-z0-9]{16,256}$/i;
export const TRELLO_SIGN_IN_PORT = 51842;
export const TRELLO_SIGN_IN_ORIGIN = `http://127.0.0.1:${TRELLO_SIGN_IN_PORT}`;
const TIMEOUT_MS = 5 * 60_000;

/** A Trello app key is public, but the owner supplies it at build time, outside Git. */
export function trelloPublicAppKey(appPath: string, environmentKey = process.env.BRANCHLOOM_TRELLO_PUBLIC_KEY): string | null {
  if (environmentKey && API_KEY.test(environmentKey)) return environmentKey;
  try {
    const path = join(appPath, 'trello-public-app.json');
    if (statSync(path).size > 1024) return null;
    const value = JSON.parse(readFileSync(path, 'utf8')) as { key?: unknown };
    return typeof value.key === 'string' && API_KEY.test(value.key) ? value.key : null;
  } catch { return null; }
}

function page(message: string, script: string | null = null, nonce = ''): string {
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Branchloom · Trello</title><body><main><h1>${message}</h1><p>Du kannst dieses Fenster schließen und zu Branchloom zurückkehren.</p></main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
}

const RETURN_SCRIPT = `
  const state = new URLSearchParams(location.search).get('state') || '';
  const result = new URLSearchParams(location.hash.slice(1));
  const token = result.get('token') || '';
  const error = result.get('error') || '';
  history.replaceState(null, '', '/trello/return');
  fetch('/trello/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, token, error }) })
    .then(response => { document.querySelector('h1').textContent = response.ok ? 'Trello ist verbunden' : 'Trello-Verbindung fehlgeschlagen'; })
    .catch(() => { document.querySelector('h1').textContent = 'Trello-Verbindung fehlgeschlagen'; });
`;

function send(response: ServerResponse, status: number, body: string, nonce = ''): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; base-uri 'none'; form-action 'none'; ${nonce ? `script-src 'nonce-${nonce}'; connect-src 'self'` : ''}`,
  });
  response.end(body);
}

function callbackBody(request: IncomingMessage): Promise<{ state: string; token: string; error: string }> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      if (tooLarge) return;
      raw += chunk;
      if (raw.length > 1024) { tooLarge = true; raw = ''; }
    });
    request.on('end', () => {
      if (tooLarge) { reject(new Error('Trello-Rückmeldung ist zu groß.')); return; }
      try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (typeof value.state !== 'string' || typeof value.token !== 'string' || typeof value.error !== 'string') throw new Error('Ungültige Trello-Rückmeldung.');
        resolve({ state: value.state, token: value.token, error: value.error });
      } catch { reject(new Error('Ungültige Trello-Rückmeldung.')); }
    });
    request.on('error', reject);
  });
}

/** Browser consent returns a token fragment to a one-use localhost page, then stores it encrypted. */
export class TrelloSignIn {
  private cancelActive: (() => void) | null = null;

  constructor(
    private readonly connection: TrelloConnection,
    private readonly appKey: string | null,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly port = TRELLO_SIGN_IN_PORT,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}

  available(): boolean { return Boolean(this.appKey && API_KEY.test(this.appKey)); }
  cancel(): void { this.cancelActive?.(); }

  async run(): Promise<TrelloConnectionStatus> {
    if (!this.available()) throw new Error('Dieser Build enthält noch keinen Branchloom-Trello-Zugang. Verwende vorerst den erweiterten Verbindungsweg.');
    if (this.cancelActive) throw new Error('Eine Trello-Anmeldung läuft bereits.');
    const key = this.appKey!;
    const state = randomBytes(24).toString('hex');
    let activePort = this.port;
    const origin = () => `http://127.0.0.1:${activePort}`;
    let finish: (value: TrelloConnectionStatus) => void = () => undefined;
    let fail: (reason: Error) => void = () => undefined;
    let settled = false;
    let completing = false;
    const result = new Promise<TrelloConnectionStatus>((resolve, reject) => { finish = resolve; fail = reject; });
    void result.catch(() => undefined);
    const settle = (value: TrelloConnectionStatus | Error) => {
      if (settled) return;
      settled = true;
      if (value instanceof Error) fail(value); else finish(value);
    };
    const server = createServer(async (request, response) => {
      if (request.headers.host !== `127.0.0.1:${activePort}`) { send(response, 403, page('Ungültiger Aufruf')); return; }
      let path: URL;
      try { path = new URL(request.url ?? '', origin()); }
      catch { send(response, 400, page('Ungültiger Aufruf')); return; }
      if (path.origin !== origin()) { send(response, 403, page('Ungültiger Aufruf')); return; }
      if (request.method === 'GET' && path.pathname === '/trello/return' && path.searchParams.get('state') === state && !settled) {
        const nonce = randomBytes(16).toString('base64');
        send(response, 200, page('Trello-Anmeldung wird abgeschlossen…', RETURN_SCRIPT, nonce), nonce);
        return;
      }
      if (request.method === 'POST' && path.pathname === '/trello/finish' && !settled && !completing) {
        if (request.headers.origin !== origin() || request.headers['content-type']?.split(';')[0] !== 'application/json') {
          send(response, 403, page('Ungültiger Aufruf')); return;
        }
        try {
          const body = await callbackBody(request);
          if (body.state !== state) { send(response, 403, page('Ungültiger Aufruf')); return; }
          if (completing) { send(response, 409, page('Anmeldung läuft bereits')); return; }
          completing = true;
          if (body.error || !API_TOKEN.test(body.token)) {
            send(response, 400, page('Trello-Anmeldung abgelehnt'));
            settle(new Error(body.error ? 'Die Trello-Freigabe wurde abgelehnt.' : 'Trello hat keinen gültigen Token geliefert.'));
            return;
          }
          const status = await this.connection.connect({ key, token: body.token });
          send(response, 200, page('Trello ist verbunden'));
          settle(status);
        } catch (reason) {
          send(response, 400, page('Trello-Verbindung fehlgeschlagen'));
          settle(reason instanceof Error ? reason : new Error('Trello-Verbindung fehlgeschlagen.'));
        }
        return;
      }
      send(response, 404, page('Ungültiger Aufruf'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
    } catch {
      throw new Error(`Lokaler Anmelde-Port ${this.port} ist nicht verfügbar. Bitte eine andere Anwendung auf diesem Port schließen.`);
    }
    const address = server.address();
    if (!address || typeof address === 'string') { server.close(); throw new Error('Lokaler Anmelde-Port konnte nicht geprüft werden.'); }
    activePort = address.port;
    const timer = setTimeout(() => { if (!completing) settle(new Error('Trello-Anmeldung hat zu lange gedauert. Bitte erneut versuchen.')); }, this.timeoutMs);
    this.cancelActive = () => { if (!completing) settle(new Error('Trello-Anmeldung abgebrochen.')); };
    const returnUrl = new URL('/trello/return', origin());
    returnUrl.searchParams.set('state', state);
    const authorize = new URL('https://trello.com/1/authorize');
    for (const [name, value] of Object.entries({ key, name: 'Branchloom', scope: 'read', expiration: '30days', response_type: 'token', callback_method: 'fragment', return_url: returnUrl.toString() })) authorize.searchParams.set(name, value);
    let browserOpened = false;
    try {
      await this.openExternal(authorize.toString());
      browserOpened = true;
      return await result;
    } catch (reason) {
      if (!browserOpened) throw new Error('Trello-Anmeldung konnte nicht im Browser geöffnet werden.');
      throw reason;
    } finally {
      clearTimeout(timer);
      this.cancelActive = null;
      server.close();
    }
  }
}
