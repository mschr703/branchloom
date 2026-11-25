import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DevEnvironmentRunner, checkedDevEnvironmentProfile, devEnvironmentProfile, saveDevEnvironmentProfile } from '../../src/main/dev-environment';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
const runners: DevEnvironmentRunner[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

function git(cwd: string, ...args: string[]): void { execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' }); }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-card-env-'));
  roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data');
  mkdirSync(repo); mkdirSync(data);
  git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Synthetic'); git(repo, 'config', 'user.email', 'synthetic@example.invalid');
  writeFileSync(join(repo, 'dev-server.js'), `const http = require('node:http'); const fs = require('node:fs');
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    http.createServer((_req, res) => { res.writeHead(200, {'content-type':'text/plain'}); res.end('READY:' + fs.readFileSync('variant.txt','utf8')); }).listen(port, '127.0.0.1', () => console.log('synthetic server listening'));`);
  writeFileSync(join(repo, 'variant.txt'), 'base');
  writeFileSync(join(repo, 'grandchild-server.js'), `const http = require('node:http');
    const port = Number(process.argv[2]);
    http.createServer((_req, res) => res.end('READY:grandchild')).listen(port, '127.0.0.1');`);
  writeFileSync(join(repo, 'parent-server.js'), `const { spawn } = require('node:child_process');
    spawn(process.execPath, ['grandchild-server.js', process.argv[process.argv.indexOf('--port') + 1]], { stdio: 'ignore' });
    setInterval(() => {}, 1000);`);
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'synthetic app');
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath); stores.push(store);
  const project = store.createProject({ name: 'Synthetic app', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const first = store.createCard({ projectId: project.id, columnId, title: 'Variant A' });
  const second = store.createCard({ projectId: project.id, columnId, title: 'Variant B' });
  const profile = { projectId: project.id, executable: process.execPath, args: ['dev-server.js', '--host', '127.0.0.1', '--port', '{port}'], healthPath: '/', healthMarker: 'READY:' };
  return { root, repo, data, dbPath, store, project, first, second, profile };
}

async function ready(runner: DevEnvironmentRunner, cardId: string) {
  for (let i = 0; i < 60; i++) {
    const run = runner.card(cardId);
    if (run?.state === 'ready' || run?.state === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Development server did not finish starting.');
}

describe('manual card development environments', () => {
  it('validates and persists a direct executable profile without starting a process', () => {
    const { store, project, profile, dbPath } = fixture();
    expect(devEnvironmentProfile(store, project.id)).toBeNull();
    expect(() => checkedDevEnvironmentProfile({ ...profile, args: ['--port', '{port}'] })).toThrow('127.0.0.1');
    expect(() => checkedDevEnvironmentProfile({ ...profile, healthPath: '//elsewhere' })).toThrow();
    expect(() => checkedDevEnvironmentProfile({ ...profile, args: ['--host', '127.0.0.1'] })).toThrow('{port}');
    const saved = saveDevEnvironmentProfile(store, profile);
    expect(saved.executable).toBe(process.execPath);
    store.close(); stores.splice(stores.indexOf(store), 1);
    const reopened = new StudioStore(dbPath); stores.push(reopened);
    expect(devEnvironmentProfile(reopened, project.id)).toEqual(saved);
  });

  it('runs two distinct worktree variants on separate ports and stops only the selected one', async () => {
    const { store, first, second, profile } = fixture();
    saveDevEnvironmentProfile(store, profile);
    const firstWorktree = ensureCardWorktree(store, first.id);
    const secondWorktree = ensureCardWorktree(store, second.id);
    writeFileSync(join(firstWorktree.cwd, 'variant.txt'), 'A');
    writeFileSync(join(secondWorktree.cwd, 'variant.txt'), 'B');
    const runner = new DevEnvironmentRunner(store); runners.push(runner);
    const [launchedA, launchedB] = await Promise.all([runner.start(first.id), runner.start(second.id)]);
    expect(launchedA.port).not.toBe(launchedB.port);
    const [a, b] = await Promise.all([ready(runner, first.id), ready(runner, second.id)]);
    expect(a?.state).toBe('ready'); expect(b?.state).toBe('ready');
    expect(runner.card(first.id)?.output).toContain('synthetic server listening');
    expect(await (await fetch(a!.url)).text()).toBe('READY:A');
    expect(await (await fetch(b!.url)).text()).toBe('READY:B');
    await expect(runner.start(first.id)).rejects.toThrow('already has');
    expect(runner.stop(a!.id).state).toBe('stopped');
    expect(await (await fetch(b!.url)).text()).toBe('READY:B');
    expect(runner.stop(b!.id).state).toBe('stopped');
  });

  it('stops a preview served by a grandchild process before reporting stopped', async () => {
    const { store, first, profile } = fixture();
    saveDevEnvironmentProfile(store, { ...profile, args: ['parent-server.js', '--host', '127.0.0.1', '--port', '{port}'], healthMarker: 'READY:grandchild' });
    const runner = new DevEnvironmentRunner(store); runners.push(runner);
    const started = await runner.start(first.id);
    expect((await ready(runner, first.id))?.state).toBe('ready');
    expect(await (await fetch(started.url)).text()).toBe('READY:grandchild');
    expect(runner.stop(started.id).state).toBe('stopped');
    let portReleased = false;
    for (let attempt = 0; attempt < 30 && !portReleased; attempt++) {
      const probe = createServer();
      portReleased = await new Promise<boolean>((resolve) => {
        probe.once('error', () => resolve(false));
        probe.listen(started.port, '127.0.0.1', () => probe.close(() => resolve(true)));
      });
      if (!portReleased) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(portReleased).toBe(true);
  });

  it('rejects occupied ports and archived cards without claiming a ready preview', async () => {
    const { store, project, first, profile } = fixture();
    saveDevEnvironmentProfile(store, profile);
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const runner = new DevEnvironmentRunner(store, async () => address.port); runners.push(runner);
    try {
      await expect(runner.start(first.id)).rejects.toThrow('No free local development port');
      expect(runner.card(first.id)).toBeNull();
      store.setCardArchived({ id: first.id, archived: true });
      await expect(runner.start(first.id)).rejects.toThrow('Restore the card');
      expect(devEnvironmentProfile(store, project.id)).not.toBeNull();
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('retains a failed start, never replays it and keeps the profile after restart', async () => {
    const { store, first, profile, dbPath } = fixture();
    saveDevEnvironmentProfile(store, { ...profile, executable: 'missing-branchloom-executable-xyz' });
    const runner = new DevEnvironmentRunner(store); runners.push(runner);
    await expect(runner.start(first.id)).rejects.toThrow();
    expect(runner.card(first.id)?.state).toBe('failed');
    runners.splice(runners.indexOf(runner), 1); runner.dispose();
    store.close(); stores.splice(stores.indexOf(store), 1);
    const reopened = new StudioStore(dbPath); stores.push(reopened);
    const after = new DevEnvironmentRunner(reopened); runners.push(after);
    expect(after.card(first.id)?.state).toBe('failed');
    expect(devEnvironmentProfile(reopened, profile.projectId)?.executable).toBe('missing-branchloom-executable-xyz');
  });

  it('reuses a verified project profile for both cards after a clean app restart without replaying either server', async () => {
    const { store, first, second, profile, dbPath } = fixture();
    const saved = saveDevEnvironmentProfile(store, profile);
    const firstTree = ensureCardWorktree(store, first.id);
    const secondTree = ensureCardWorktree(store, second.id);
    writeFileSync(join(firstTree.cwd, 'variant.txt'), 'A');
    writeFileSync(join(secondTree.cwd, 'variant.txt'), 'B');
    const original = new DevEnvironmentRunner(store); runners.push(original);
    await Promise.all([original.start(first.id), original.start(second.id)]);
    expect((await ready(original, first.id))?.state).toBe('ready');
    expect((await ready(original, second.id))?.state).toBe('ready');
    const firstRun = original.card(first.id)!;
    const secondRun = original.card(second.id)!;
    expect(await (await fetch(firstRun.url)).text()).toBe('READY:A');
    expect(await (await fetch(secondRun.url)).text()).toBe('READY:B');

    original.dispose(); runners.splice(runners.indexOf(original), 1);
    store.close(); stores.splice(stores.indexOf(store), 1);
    const reopened = new StudioStore(dbPath); stores.push(reopened);
    const next = new DevEnvironmentRunner(reopened); runners.push(next);
    expect(devEnvironmentProfile(reopened, profile.projectId)?.fingerprint).toBe(saved.fingerprint);
    expect(next.card(first.id)).toMatchObject({ id: firstRun.id, state: 'stopped', managed: false });
    expect(next.card(second.id)).toMatchObject({ id: secondRun.id, state: 'stopped', managed: false });
    expect(reopened.db.prepare('SELECT COUNT(*) AS count FROM dev_environment_runs').get()).toMatchObject({ count: 2 });
    await expect(fetch(firstRun.url)).rejects.toThrow();
    await expect(fetch(secondRun.url)).rejects.toThrow();

    const [restartedA, restartedB] = await Promise.all([next.start(first.id), next.start(second.id)]);
    expect(restartedA.id).not.toBe(firstRun.id);
    expect(restartedB.id).not.toBe(secondRun.id);
    expect(restartedA.port).not.toBe(restartedB.port);
    expect((await ready(next, first.id))?.state).toBe('ready');
    expect((await ready(next, second.id))?.state).toBe('ready');
    expect(await (await fetch(next.card(first.id)!.url)).text()).toBe('READY:A');
    expect(await (await fetch(next.card(second.id)!.url)).text()).toBe('READY:B');
  });

  it('marks a stale active run interrupted after restart without launching it again', () => {
    const { store, first, profile, dbPath } = fixture();
    saveDevEnvironmentProfile(store, profile);
    const worktree = ensureCardWorktree(store, first.id);
    store.db.prepare(`INSERT INTO dev_environment_runs
      (id, project_id, card_id, worktree_path, branch, port, pid, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)`).run(
      'stale-run', profile.projectId, first.id, worktree.path, worktree.branch, 45678, 99999999, new Date().toISOString(),
    );
    store.close(); stores.splice(stores.indexOf(store), 1);
    const reopened = new StudioStore(dbPath); stores.push(reopened);
    const runner = new DevEnvironmentRunner(reopened); runners.push(runner);
    expect(runner.card(first.id)).toMatchObject({ id: 'stale-run', state: 'interrupted', managed: false });
    expect(reopened.db.prepare('SELECT COUNT(*) AS count FROM dev_environment_runs WHERE card_id = ?').get(first.id)).toMatchObject({ count: 1 });
  });
});
