import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { previewApiContract, saveApiContract } from '../../src/main/api-contract';
import { ApiContractHttp } from '../../src/main/api-contract-http';
import type { ApiContractDraft } from '../../src/shared/api-contract';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });
const draft: ApiContractDraft = { method: 'GET', path: '/api/items', response: 'array', fields: [
  { name: 'id', type: 'string', required: true }, { name: 'count', type: 'number', required: true },
], error: { status: 404, code: 'NOT_FOUND', message: 'No item found' } };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-contract-http-'));
  roots.push(root);
  const projectPath = join(root, 'project'); mkdirSync(projectPath);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic HTTP contract', path: projectPath });
  const preview = previewApiContract(store, { projectId: project.id, draft });
  const first = saveApiContract(store, { projectId: project.id, draft, fingerprint: preview.fingerprint, expectedLatestRevision: preview.expectedLatestRevision });
  return { root, file, store, project, first };
}
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address');
  return address.port;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }

describe('local API contract mock and live check', () => {
  it('serves only the selected GET route and error example on loopback, then stops', async () => {
    const f = fixture(); const controller = new ApiContractHttp(f.store);
    try {
      const [state, duplicate] = await Promise.all([
        controller.start({ projectId: f.project.id, revision: 1 }),
        controller.start({ projectId: f.project.id, revision: 1 }),
      ]);
      expect(state).toMatchObject({ running: true, current: true, revision: 1, fingerprint: f.first.fingerprint });
      expect(duplicate.url).toBe(state.url);
      expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/items$/);
      const success = await fetch(state.url!);
      expect(success.status).toBe(200);
      expect(await success.json()).toEqual(f.first.example);
      const failure = await fetch(state.errorUrl!);
      expect(failure.status).toBe(404);
      expect(await failure.json()).toEqual(f.first.errorExample);
      expect((await fetch(`${new URL(state.url!).origin}/api/other`)).status).toBe(404);
      expect((await fetch(state.url!, { method: 'POST' })).status).toBe(405);
      expect((await fetch(state.url!, { headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
      expect((await controller.stop(f.project.id)).running).toBe(false);
      await expect(fetch(state.url!)).rejects.toThrow();
      const restarted = await controller.start({ projectId: f.project.id, revision: 1 });
      const nextDraft = { ...draft, path: '/api/records' };
      const preview = previewApiContract(f.store, { projectId: f.project.id, draft: nextDraft });
      saveApiContract(f.store, { projectId: f.project.id, draft: nextDraft, fingerprint: preview.fingerprint, expectedLatestRevision: preview.expectedLatestRevision });
      expect(controller.state(f.project.id).current).toBe(false);
      expect((await fetch(restarted.url!)).status).toBe(410);
      const latest = await controller.start({ projectId: f.project.id, revision: 2 });
      expect(latest.url).toContain('/api/records');
      let oldStatus: number | null = null;
      try { oldStatus = (await fetch(restarted.url!)).status; } catch { /* Closed port. */ }
      expect(oldStatus).not.toBe(200);
    } finally { controller.dispose(); f.store.close(); }
    const reopened = new StudioStore(f.file); const afterRestart = new ApiContractHttp(reopened);
    try { expect(afterRestart.state(f.project.id).running).toBe(false); }
    finally { afterRestart.dispose(); reopened.close(); }
  });

  it('checks real responses with exact paths, stores no response body, and marks old checks stale after restart', async () => {
    const f = fixture(); const controller = new ApiContractHttp(f.store);
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/items') { res.statusCode = 200; res.end('[{"id":4,"count":"wrong"}]'); }
      else { res.statusCode = 404; res.end('{}'); }
    });
    const port = await listen(server);
    try {
      const result = await controller.check({ projectId: f.project.id, revision: 1, baseUrl: `http://127.0.0.1:${port}` });
      expect(result).toMatchObject({ status: 200, valid: false, current: true });
      expect(result.mismatches).toEqual([{ path: '$[0].id', expected: 'string', actual: 'number' }, { path: '$[0].count', expected: 'number', actual: 'string' }]);
      expect(JSON.stringify(controller.checks(f.project.id))).not.toContain('wrong');
      const secondDraft = { ...draft, fields: [...draft.fields, { name: 'active', type: 'boolean' as const, required: true }] };
      const preview = previewApiContract(f.store, { projectId: f.project.id, draft: secondDraft });
      saveApiContract(f.store, { projectId: f.project.id, draft: secondDraft, fingerprint: preview.fingerprint, expectedLatestRevision: preview.expectedLatestRevision });
      expect(controller.checks(f.project.id)[0]).toMatchObject({ revision: 1, current: false });
      await expect(controller.check({ projectId: f.project.id, revision: 1, baseUrl: `http://127.0.0.1:${port}` })).rejects.toThrow('stale');
    } finally { controller.dispose(); await close(server); f.store.close(); }
    const reopened = new StudioStore(f.file); const afterRestart = new ApiContractHttp(reopened);
    try {
      expect(afterRestart.state(f.project.id).running).toBe(false);
      expect(afterRestart.checks(f.project.id)).toMatchObject([{ revision: 1, current: false, status: 200 }]);
    } finally { afterRestart.dispose(); reopened.close(); }
  });

  it('accepts a matching local backend and never follows redirects or accepts a non-loopback target', async () => {
    const f = fixture(); const controller = new ApiContractHttp(f.store);
    let mode: 'success' | 'error' | 'redirect' = 'success';
    const server = createServer((req, res) => {
      if (req.url === '/api/items' && mode === 'redirect') { res.writeHead(302, { Location: 'https://untrusted.example/' }); res.end(); }
      else if (req.url === '/api/items' && mode === 'error') { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(f.first.errorExample)); }
      else if (req.url === '/api/items') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(f.first.example)); }
      else { res.writeHead(302, { Location: 'https://untrusted.example/' }); res.end(); }
    });
    const port = await listen(server);
    try {
      const good = await controller.check({ projectId: f.project.id, revision: 1, baseUrl: `http://127.0.0.1:${port}` });
      expect(good).toMatchObject({ valid: true, status: 200, current: true, mismatches: [] });
      mode = 'error';
      const expectedError = await controller.check({ projectId: f.project.id, revision: 1, baseUrl: `http://127.0.0.1:${port}` });
      expect(expectedError).toMatchObject({ valid: true, status: 404, current: true, mismatches: [] });
      mode = 'redirect';
      const redirected = await controller.check({ projectId: f.project.id, revision: 1, baseUrl: `http://127.0.0.1:${port}` });
      expect(redirected).toMatchObject({ valid: false, status: 302 });
      expect(redirected.mismatches[0]).toEqual({ path: 'status', expected: '200 or 404', actual: '302' });
      for (const baseUrl of ['https://127.0.0.1:3000', 'http://localhost:3000', 'http://127.0.0.2:3000', 'http://127.0.0.1:3000/other', 'http://user:pass@127.0.0.1:3000']) {
        await expect(controller.check({ projectId: f.project.id, revision: 1, baseUrl })).rejects.toThrow();
      }
      expect(controller.checks(f.project.id)).toHaveLength(3);
    } finally { controller.dispose(); await close(server); f.store.close(); }
  });

  it('bounds large responses and waiting servers without storing their bodies', async () => {
    const f = fixture(); const controller = new ApiContractHttp(f.store);
    let mode: 'large' | 'wait' = 'large';
    const server = createServer((_req, res) => {
      if (mode === 'large') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('x'.repeat(40_000)); }
      // A deliberately non-responsive local endpoint exercises the five-second limit.
    });
    const port = await listen(server);
    try {
      const large = await controller.check({ projectId: f.project.id, revision: 1, baseUrl: `http://127.0.0.1:${port}` });
      expect(large).toMatchObject({ valid: false, status: 200 });
      expect(large.mismatches[0]?.actual).toContain('32 KB');
      mode = 'wait';
      const started = Date.now();
      const timeout = await controller.check({ projectId: f.project.id, revision: 1, baseUrl: `http://127.0.0.1:${port}` });
      expect(timeout.status).toBeNull();
      expect(timeout.valid).toBe(false);
      expect(timeout.mismatches[0]?.actual).toContain('timeout');
      expect(Date.now() - started).toBeLessThan(8_000);
      expect(JSON.stringify(controller.checks(f.project.id))).not.toContain('xxxxx');
    } finally { controller.dispose(); await close(server); f.store.close(); }
  }, 12_000);

  it('reports connection failures without claiming an HTTP response and keeps a failed mock start stopped', async () => {
    const f = fixture(); const controller = new ApiContractHttp(f.store);
    // A reserved local port is released before the probe, so no server can answer.
    const temporary = createServer();
    await listen(temporary);
    const address = temporary.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    const port = address.port;
    await close(temporary);
    try {
      const failed = await controller.check({ projectId: f.project.id, revision: 1, baseUrl: `http://127.0.0.1:${port}` });
      expect(failed).toMatchObject({ status: null, valid: false, mismatches: [{ path: 'connection', expected: 'HTTP response', actual: 'connection refused' }] });
    } finally { controller.dispose(); }
    const brokenFactory = ((listener: Parameters<typeof createServer>[0]) => {
      const server = createServer(listener);
      server.listen = (() => { queueMicrotask(() => server.emit('error', new Error('synthetic bind failure'))); return server; }) as Server['listen'];
      return server;
    }) as typeof createServer;
    const broken = new ApiContractHttp(f.store, brokenFactory);
    try {
      await expect(broken.start({ projectId: f.project.id, revision: 1 })).rejects.toThrow('synthetic bind failure');
      expect(broken.state(f.project.id).running).toBe(false);
    } finally { broken.dispose(); f.store.close(); }
  });
});
