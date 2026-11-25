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
  sessions: new Map<string, { identity: { subject: string; role: string } | null; requestHandler: ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | null; fetches: string[]; seedRows: Map<string, string>; seedPosts: number; cleared: boolean }>(),
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
        fetches: [] as string[], seedRows: new Map<string, string>(), seedPosts: 0, cleared: false,
        setPermissionRequestHandler: () => undefined, setPermissionCheckHandler: () => undefined, on: () => undefined,
        webRequest: { onBeforeRequest: (handler: typeof value.requestHandler) => { value.requestHandler = handler; } },
        async fetch(url: string, init?: RequestInit) {
          value.fetches.push(url);
          if (new URL(url).pathname === '/__branchloom/accounts') {
            if (!value.identity) return new Response('{}', { status: 401 });
            if (init?.method === 'POST') {
              value.seedPosts++;
              const body = JSON.parse(String(init.body)) as { subject: string; role: string; requestId: string };
              const created = !value.seedRows.has(body.subject);
              value.seedRows.set(body.subject, body.role);
              return new Response(JSON.stringify({ ...body, exists: true, created }), { status: created ? 201 : 200 });
            }
            const subject = new URL(url).searchParams.get('subject') ?? '';
            const role = new URL(url).searchParams.get('role') ?? '';
            return new Response(JSON.stringify({ subject, role, exists: value.seedRows.get(subject) === role }));
          }
          return value.identity ? new Response(JSON.stringify(value.identity), { status: 200 }) : new Response('{}', { status: 401 });
        },
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

  it('checks a local target, requires confirmation, persists the attempt, and detects a reset target', async () => {
    const f = fixture();
    f.browser.saveSeedConfig({ cardId: f.first.id, path: '/__branchloom/accounts' });
    const sessionName = `branchloom-dev-account-${f.admin.id}`;
    expect((await f.browser.checkSeed(f.first.id, f.user.id)).state).toBe('login-required');
    const ses = mocked.sessions.get(sessionName)!;
    expect(ses.seedPosts).toBe(0);
    ses.identity = { subject: f.admin.subject, role: f.admin.role };
    const check = await f.browser.checkSeed(f.first.id, f.user.id);
    expect(check.state).toBe('missing');
    expect(ses.seedPosts).toBe(0);
    await expect(f.browser.createSeed(f.first.id, f.user.id, 'invalid')).rejects.toThrow('expired');
    const attempt = await f.browser.createSeed(f.first.id, f.user.id, check.id!);
    expect(attempt.state).toBe('created');
    expect(ses.seedPosts).toBe(1);
    expect(f.browser.lastSeedAttempt(f.first.id, f.user.id)?.state).toBe('created');
    await expect(f.browser.createSeed(f.first.id, f.user.id, check.id!)).rejects.toThrow('expired');
    expect((await f.browser.checkSeed(f.first.id, f.user.id)).state).toBe('exists');
    ses.seedRows.clear(); // The target app reset its own database.
    expect((await f.browser.checkSeed(f.first.id, f.user.id)).state).toBe('missing');
    f.browser.dispose();
  });

  it('rejects stale preview/config/grant before a seed POST', async () => {
    const f = fixture();
    f.browser.saveSeedConfig({ cardId: f.first.id, path: '/__branchloom/accounts' });
    const ses = mocked.sessions.get(`branchloom-dev-account-${f.admin.id}`) ?? (await f.browser.probe(f.first.id), mocked.sessions.get(`branchloom-dev-account-${f.admin.id}`)!);
    ses.identity = { subject: f.admin.subject, role: f.admin.role };
    const first = await f.browser.checkSeed(f.first.id, f.user.id);
    f.runs.set(f.first.id, { ...f.runs.get(f.first.id)!, id: 'restarted-run' });
    await expect(f.browser.createSeed(f.first.id, f.user.id, first.id!)).rejects.toThrow('changed');
    expect(ses.seedPosts).toBe(0);
    const second = await f.browser.checkSeed(f.first.id, f.user.id);
    f.browser.saveSeedConfig({ cardId: f.first.id, path: '/new-seed-path' });
    await expect(f.browser.createSeed(f.first.id, f.user.id, second.id!)).rejects.toThrow('expired');
    expect(ses.seedPosts).toBe(0);
    f.browser.dispose();
  });
});
