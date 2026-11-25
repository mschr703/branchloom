import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { CardDevEnvironment } from '../../src/shared/dev-environment';
import type { DevEnvironmentRunner } from '../../src/main/dev-environment';
import { StudioStore } from '../../src/main/store';
import { assignDevAccount, createDevAccount, devAccountOverview } from '../../src/main/dev-account';

const mocked = vi.hoisted(() => ({
  sessions: new Map<string, { identity: { subject: string; role: string } | null; requestHandler: ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | null; fetches: string[]; cleared: boolean }>(),
  windows: [] as Array<{ options: { webPreferences: { session: unknown } }; url: string; destroyed: boolean }>,
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWindow extends EventEmitter {
    url = ''; destroyed = false;
    webContents = { setWindowOpenHandler: () => undefined, on: () => undefined };
    constructor(public options: { webPreferences: { session: unknown } }) { super(); mocked.windows.push(this); }
    async loadURL(url: string) { this.url = url; }
    isDestroyed() { return this.destroyed; }
    show() {}
    focus() {}
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  }
  return {
    BrowserWindow: FakeWindow,
    session: { fromPartition: (name: string) => {
      const existing = mocked.sessions.get(name);
      if (existing) return existing;
      const value = {
        identity: null as { subject: string; role: string } | null,
        requestHandler: null as ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | null,
        fetches: [] as string[], cleared: false,
        setPermissionRequestHandler: () => undefined, setPermissionCheckHandler: () => undefined, on: () => undefined,
        webRequest: { onBeforeRequest: (handler: typeof value.requestHandler) => { value.requestHandler = handler; } },
        async fetch(url: string) { value.fetches.push(url); return value.identity ? new Response(JSON.stringify(value.identity), { status: 200 }) : new Response('{}', { status: 401 }); },
        async clearStorageData() { value.identity = null; value.cleared = true; },
      };
      mocked.sessions.set(name, value);
      return value;
    } },
  };
});

import { DevAccountBrowser } from '../../src/main/dev-account-browser';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  mocked.sessions.clear(); mocked.windows.length = 0;
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-dev-browser-')); roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const store = new StudioStore(join(root, 'studio.sqlite')); stores.push(store);
  const project = store.createProject({ name: 'Synthetic shop', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const first = store.createCard({ projectId: project.id, columnId, title: 'Admin' });
  const second = store.createCard({ projectId: project.id, columnId, title: 'User' });
  const admin = createDevAccount(store, { projectId: project.id, service: 'Shop', environment: 'local', role: 'admin', subject: 'admin-fixture', probePath: '/api/me' });
  const user = createDevAccount(store, { projectId: project.id, service: 'Shop', environment: 'local', role: 'user', subject: 'user-fixture', probePath: '/api/me' });
  for (const [card, account] of [[first, admin], [second, user]] as const) assignDevAccount(store, { projectId: project.id, cardId: card.id, accountId: account.id,
    expectedCardRevision: devAccountOverview(store, { projectId: project.id, cardId: card.id }).cardRevision });
  const runs = new Map<string, CardDevEnvironment>();
  for (const [card, port] of [[first, 55101], [second, 55102]] as const) runs.set(card.id, { id: `run-${port}`, cardId: card.id, projectId: project.id,
    url: `http://127.0.0.1:${port}/`, port, state: 'ready', managed: true } as CardDevEnvironment);
  const environment = { card: (id: string) => runs.get(id) ?? null } as unknown as DevEnvironmentRunner;
  const parent = { isDestroyed: () => false } as unknown as BrowserWindow;
  const browser = new DevAccountBrowser(store, environment, () => parent);
  return { store, project, first, second, admin, user, runs, browser };
}

describe('isolated development account windows', () => {
  it('uses separate memory-only browser partitions for two cards and probes their own identities', async () => {
    const f = fixture();
    expect(await f.browser.open(f.first.id)).toBe('http://127.0.0.1:55101/');
    expect(await f.browser.open(f.second.id)).toBe('http://127.0.0.1:55102/');
    expect(mocked.windows).toHaveLength(2);
    const adminSession = mocked.sessions.get(`branchloom-dev-account-${f.admin.id}`)!;
    const userSession = mocked.sessions.get(`branchloom-dev-account-${f.user.id}`)!;
    expect(adminSession).not.toBe(userSession);
    expect([...mocked.sessions.keys()].every((name) => !name.startsWith('persist:'))).toBe(true);
    const checkRequest = (ses: typeof adminSession, url: string) => { let cancelled: boolean | null = null; ses.requestHandler!({ url }, (result) => { cancelled = result.cancel; }); return cancelled; };
    expect(checkRequest(adminSession, 'http://127.0.0.1:55101/api/me')).toBe(false);
    expect(checkRequest(adminSession, 'https://external.example/collect')).toBe(true);
    expect(checkRequest(adminSession, 'http://127.0.0.1:55102/api/me')).toBe(true);
    adminSession.identity = { subject: f.admin.subject, role: f.admin.role };
    userSession.identity = { subject: f.user.subject, role: f.user.role };
    expect((await f.browser.probe(f.first.id)).state).toBe('verified');
    expect((await f.browser.probe(f.second.id)).state).toBe('verified');
    f.browser.dispose();
  });

  it('keeps a grant across port changes but denies revoked cards and forgets a login', async () => {
    const f = fixture();
    await f.browser.open(f.first.id);
    const ses = mocked.sessions.get(`branchloom-dev-account-${f.admin.id}`)!;
    ses.identity = { subject: f.admin.subject, role: f.admin.role };
    f.runs.set(f.first.id, { ...f.runs.get(f.first.id)!, id: 'new-run', port: 55200, url: 'http://127.0.0.1:55200/' });
    let staleCancelled = false;
    ses.requestHandler!({ url: 'http://127.0.0.1:55101/api/me' }, (result) => { staleCancelled = result.cancel; });
    expect(staleCancelled).toBe(true);
    expect((await f.browser.probe(f.first.id)).state).toBe('verified');
    expect(mocked.windows[0]?.destroyed).toBe(true);
    await f.browser.forget(f.admin.id);
    expect(ses.cleared).toBe(true);
    expect((await f.browser.probe(f.first.id)).state).toBe('login-required');
    const revision = devAccountOverview(f.store, { projectId: f.project.id, cardId: f.first.id }).cardRevision;
    assignDevAccount(f.store, { projectId: f.project.id, cardId: f.first.id, accountId: null, expectedCardRevision: revision });
    f.browser.closeCard(f.first.id);
    await expect(f.browser.probe(f.first.id)).rejects.toThrow('No development account');
    f.browser.dispose();
  });
});
