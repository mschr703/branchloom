import { randomUUID } from 'node:crypto';
import { createServer, request, type Server, type ServerResponse } from 'node:http';
import type { ApiContractLiveCheck, ApiContractMismatch, ApiContractMockState, ApiContractVersion } from '../shared/api-contract';
import { apiContractLiveChecks, checkApiContractResponse, latestApiContractVersion, saveApiContractLiveCheck } from './api-contract';
import type { StudioStore } from './store';

const LOOPBACK = '127.0.0.1';
const MAX_RESPONSE_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
type ServerFactory = typeof createServer;

function currentVersion(store: StudioStore, projectId: string, revision: number): ApiContractVersion {
  const version = latestApiContractVersion(store, projectId);
  if (!version || version.revision !== revision) throw new Error('The selected API contract revision is stale. Reload and choose the latest revision.');
  return version;
}

function localOrigin(input: string): { port: number; origin: string } {
  if (typeof input !== 'string' || input.length > 100) throw new Error('Enter a local HTTP origin, for example http://127.0.0.1:3000.');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Enter a valid local HTTP origin.'); }
  if (url.protocol !== 'http:' || url.hostname !== LOOPBACK || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password || !/^\d{1,5}$/.test(url.port)) {
    throw new Error('Only http://127.0.0.1:<port> without credentials, path, query or fragment is allowed.');
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Local port must be between 1 and 65535.');
  return { port, origin: `http://${LOOPBACK}:${port}` };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(text);
}

interface ActiveMock { server: Server; projectId: string; revision: number; fingerprint: string; port: number; path: string; startedAt: string }

export class ApiContractHttp {
  private readonly mocks = new Map<string, ActiveMock>();
  private readonly starting = new Map<string, Promise<ApiContractMockState>>();
  private disposed = false;
  constructor(private readonly store: StudioStore, private readonly serverFactory: ServerFactory = createServer) {}

  state(projectId: string): ApiContractMockState {
    this.store.project(projectId);
    const active = this.mocks.get(projectId);
    if (!active) return { projectId, running: false, revision: null, fingerprint: null, url: null, errorUrl: null, startedAt: null, current: false };
    const url = `http://${LOOPBACK}:${active.port}${active.path}`;
    return { projectId, running: true, revision: active.revision, fingerprint: active.fingerprint, url,
      errorUrl: `${url}?case=error`, startedAt: active.startedAt,
      current: latestApiContractVersion(this.store, projectId)?.revision === active.revision };
  }

  async start(input: { projectId: string; revision: number }): Promise<ApiContractMockState> {
    const pending = this.starting.get(input.projectId);
    if (pending) { try { await pending; } catch { /* Re-check after a failed start. */ } return this.start(input); }
    if (this.disposed) throw new Error('Local API mock is shutting down.');
    const operation = this.startOnce(input);
    this.starting.set(input.projectId, operation);
    try { return await operation; }
    finally { if (this.starting.get(input.projectId) === operation) this.starting.delete(input.projectId); }
  }

  private async startOnce(input: { projectId: string; revision: number }): Promise<ApiContractMockState> {
    const contract = currentVersion(this.store, input.projectId, input.revision);
    const prior = this.mocks.get(input.projectId);
    if (prior?.revision === contract.revision) return this.state(input.projectId);
    if (prior) await this.stopActive(input.projectId);
    const server = this.serverFactory((req, res) => {
      // The mock contains synthetic examples only. Do not offer a permissive
      // browser bridge to a remote page or accept unexpected routes/methods.
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(origin)) { sendJson(res, 403, { error: 'Local origins only' }); return; }
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method !== 'GET') { sendJson(res, 405, { error: 'GET only' }); return; }
      const target = req.url ?? '';
      if (target !== contract.draft.path && target !== `${contract.draft.path}?case=error`) { sendJson(res, 404, { error: 'Not found' }); return; }
      // Even a leftover server cannot silently serve an obsolete revision.
      if (latestApiContractVersion(this.store, input.projectId)?.revision !== contract.revision) { sendJson(res, 410, { error: 'Contract revision changed' }); return; }
      if (target.endsWith('?case=error')) sendJson(res, contract.draft.error.status, contract.errorExample);
      else sendJson(res, 200, contract.example);
    });
    server.requestTimeout = REQUEST_TIMEOUT_MS;
    server.headersTimeout = REQUEST_TIMEOUT_MS;
    server.maxRequestsPerSocket = 20;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); server.off('error', fail); reject(error); } };
        const done = () => { if (!settled) { settled = true; clearTimeout(timer); server.off('error', fail); resolve(); } };
        const timer = setTimeout(() => fail(new Error('bind timeout after 5 seconds')), REQUEST_TIMEOUT_MS);
        server.once('error', fail);
        try { server.listen(0, LOOPBACK, done); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local mock did not receive a TCP port.');
      currentVersion(this.store, input.projectId, input.revision);
      if (this.disposed) throw new Error('Local API mock is shutting down.');
      const active: ActiveMock = { server, projectId: input.projectId, revision: contract.revision, fingerprint: contract.fingerprint,
        port: address.port, path: contract.draft.path, startedAt: new Date().toISOString() };
      this.mocks.set(input.projectId, active);
      return this.state(input.projectId);
    } catch (error) {
      server.closeAllConnections();
      try { server.close(); } catch { /* Listen may never have succeeded. */ }
      throw new Error(`Local API mock could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stop(projectId: string): Promise<ApiContractMockState> {
    this.store.project(projectId);
    const pending = this.starting.get(projectId);
    if (pending) { try { await pending; } catch { /* A failed start has nothing to stop. */ } }
    return this.stopActive(projectId);
  }

  private async stopActive(projectId: string): Promise<ApiContractMockState> {
    const active = this.mocks.get(projectId);
    if (!active) return this.state(projectId);
    this.mocks.delete(projectId);
    active.server.closeAllConnections();
    await new Promise<void>((resolve) => active.server.close(() => resolve()));
    return this.state(projectId);
  }

  dispose(): void {
    this.disposed = true;
    for (const active of this.mocks.values()) { active.server.closeAllConnections(); active.server.close(); }
    this.mocks.clear();
  }

  checks(projectId: string): ApiContractLiveCheck[] { return apiContractLiveChecks(this.store, projectId); }

  async check(input: { projectId: string; revision: number; baseUrl: string }): Promise<ApiContractLiveCheck> {
    const contract = currentVersion(this.store, input.projectId, input.revision);
    const target = localOrigin(input.baseUrl);
    const url = `${target.origin}${contract.draft.path}`;
    let status: number | null = null;
    let body = '';
    let issue: string | null = null;
    try {
      const result = await new Promise<{ status: number; body: string; issue: string | null }>((resolve, reject) => {
        let settled = false;
        let timer: NodeJS.Timeout | null = null;
        const finish = (value: { status: number; body: string; issue: string | null }) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(value); } };
        const fail = (error: Error) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); reject(error); } };
        const req = request({ hostname: LOOPBACK, port: target.port, path: contract.draft.path, method: 'GET', timeout: REQUEST_TIMEOUT_MS,
          headers: { Accept: 'application/json', 'User-Agent': 'Branchloom-contract-check' } }, (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) { finish({ status: response.statusCode ?? 0, body: '', issue: 'response exceeds 32 KB' }); response.destroy(); }
            else chunks.push(chunk);
          });
          response.on('end', () => finish({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), issue: null }));
          response.on('error', fail);
        });
        req.on('timeout', () => { fail(new Error('timeout')); req.destroy(); });
        req.on('error', fail);
        timer = setTimeout(() => { fail(new Error('timeout')); req.destroy(); }, REQUEST_TIMEOUT_MS);
        req.end();
      });
      status = result.status;
      body = result.body;
      issue = result.issue;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      issue = code === 'ECONNREFUSED' ? 'connection refused' : error instanceof Error && error.message === 'timeout' ? 'timeout after 5 seconds' : 'connection failed';
    }
    let mismatches: ApiContractMismatch[];
    if (issue) mismatches = [{ path: status === null ? 'connection' : '$', expected: status === null ? 'HTTP response' : 'JSON response up to 32 KB', actual: issue }];
    else if (status !== 200 && status !== contract.draft.error.status) mismatches = [{ path: 'status', expected: `200 or ${contract.draft.error.status}`, actual: String(status) }];
    else {
      try { mismatches = checkApiContractResponse(this.store, { projectId: input.projectId, revision: contract.revision, status: status!, responseText: body }).mismatches; }
      catch { mismatches = [{ path: '$', expected: 'valid JSON response up to 32 KB', actual: 'invalid or oversized JSON' }]; }
    }
    return saveApiContractLiveCheck(this.store, { id: randomUUID(), projectId: input.projectId, revision: contract.revision,
      fingerprint: contract.fingerprint, url, checkedAt: new Date().toISOString(), status, valid: mismatches.length === 0, mismatches });
  }
}
