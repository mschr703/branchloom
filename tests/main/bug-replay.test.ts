import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardDevEnvironment } from '../../src/shared/dev-environment';
import type { BugCaptureDraft, BugReplayAction } from '../../src/shared/bug-replay';
import { StudioStore } from '../../src/main/store';
import { saveDevEnvironmentProfile, type DevEnvironmentRunner } from '../../src/main/dev-environment';
import { bugScenarioRuns, bugScenarios, runBugScenario, saveBugScenario } from '../../src/main/bug-replay';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-bug-replay-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'index.html'), '<button id="menu">Menu</button>');
  git('add', 'index.html');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic');
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Filter is lost' });
  saveDevEnvironmentProfile(store, { projectId: project.id, executable: 'node', args: ['server.js', '--host', '127.0.0.1', '--port', '{port}'], healthPath: '/', healthMarker: 'ready' });
  const environment = { id: 'run-1', cardId: card.id, projectId: project.id, url: 'http://127.0.0.1:5173/', state: 'ready', managed: true } as CardDevEnvironment;
  const runner = { card: () => environment, verifyCurrentPreview: () => environment, verifyCurrentPreviewAsync: async () => environment } as unknown as DevEnvironmentRunner;
  const actions: BugReplayAction[] = [{ kind: 'click', target: { kind: 'id', value: 'menu' } }, { kind: 'resize', width: 390, height: 844 }];
  const capture: BugCaptureDraft = { token: 'synthetic-token', projectId: project.id, url: 'http://127.0.0.1:5173/settings', width: 1280, height: 800,
    actions, ignoredClicks: 0, startedAt: '2026-11-25T08:00:00.000Z' };
  return { root, repo, dbPath, store, project, card, git, environment, runner, actions, capture };
}

describe('recorded local bug scenarios', () => {
  it('persists a captured sequence and reports a prepared failure then a clean fixed expectation at the same card revision', async () => {
    const f = fixture();
    const scenario = saveBugScenario(f.store, f.runner, f.capture, { cardId: f.card.id, actions: f.actions,
      expectation: { target: { kind: 'id', value: 'filter' }, state: 'visible' } });
    expect(bugScenarios(f.store, f.card.id)).toMatchObject([{ id: scenario.id, actions: f.actions }]);
    f.store.close();
    const reopened = new StudioStore(f.dbPath);
    try {
      const replay = vi.fn(async (url, width, height, actions, expectation, verifyRequest) => {
        expect(url).toBe('http://127.0.0.1:5173/settings');
        expect([width, height]).toEqual([1280, 800]);
        expect(actions).toEqual(f.actions);
        expect(expectation).toMatchObject({ target: { value: 'filter' }, state: 'visible' });
        expect(await verifyRequest('http://127.0.0.1:5173/api/state')).toBe(true);
        expect(await verifyRequest('https://example.invalid/private')).toBe(false);
        return { status: 'failed' as const, observed: 'Erwartetes Element ist verborgen oder fehlt.', width: 390, height: 844 };
      });
      const before = await runBugScenario(reopened, f.runner, scenario.id, replay);
      expect(before).toMatchObject({ status: 'failed', viewportWidth: 390, viewportHeight: 844,
        gitEvidence: { state: 'clean', startHead: f.git('rev-parse', 'HEAD') } });
      const after = await runBugScenario(reopened, f.runner, scenario.id, async () => ({ status: 'passed', observed: 'Erwartetes Element ist sichtbar.', width: 390, height: 844 }));
      expect(after.status).toBe('passed');
      expect(bugScenarioRuns(reopened, scenario.id).map((item) => item.status)).toEqual(['passed', 'failed']);
      expect(replay).toHaveBeenCalledOnce();
    } finally { reopened.close(); }
  });

  it('rejects invented actions, another project, changed card revisions and dirty Git without a false pass', async () => {
    const f = fixture();
    try {
      expect(() => saveBugScenario(f.store, f.runner, f.capture, { cardId: f.card.id,
        actions: [{ kind: 'click', target: { kind: 'id', value: 'pay-now' } }],
        expectation: { target: { kind: 'id', value: 'filter' }, state: 'visible' } })).toThrow('nicht aufgenommen');
      const otherPath = join(f.root, 'other'); mkdirSync(otherPath);
      const other = f.store.createProject({ name: 'Other', path: otherPath });
      const otherCard = f.store.createCard({ projectId: other.id, columnId: f.store.snapshot(other.id).columns[0]!.id, title: 'Other' });
      expect(() => saveBugScenario(f.store, f.runner, f.capture, { cardId: otherCard.id, actions: f.actions,
        expectation: { target: { kind: 'id', value: 'filter' }, state: 'visible' } })).toThrow('Aufnahmeprojekt');
      const scenario = saveBugScenario(f.store, f.runner, f.capture, { cardId: f.card.id, actions: [f.actions[0]!],
        expectation: { target: { kind: 'id', value: 'filter' }, state: 'visible' } });
      writeFileSync(join(f.repo, 'index.html'), 'dirty');
      const dirty = await runBugScenario(f.store, f.runner, scenario.id, async () => ({ status: 'passed', observed: 'Element ist sichtbar.', width: 1280, height: 800 }));
      expect(dirty).toMatchObject({ status: 'error', gitEvidence: { state: 'dirty' } });
      f.store.updateCard({ id: f.card.id, title: 'Changed task' });
      await expect(runBugScenario(f.store, f.runner, scenario.id, async () => { throw new Error('must not run'); })).rejects.toThrow('Kartenauftrag wurde geändert');
    } finally { f.store.close(); }
  });

  it('reserves the card before the asynchronous preview check and releases it after a failed precheck', async () => {
    const f = fixture();
    try {
      const scenario = saveBugScenario(f.store, f.runner, f.capture, { cardId: f.card.id, actions: [f.actions[0]!],
        expectation: { target: { kind: 'id', value: 'filter' }, state: 'visible' } });
      let release!: (environment: CardDevEnvironment) => void;
      const pending = new Promise<CardDevEnvironment>((resolve) => { release = resolve; });
      const runner = { ...f.runner, verifyCurrentPreviewAsync: vi.fn(() => pending) } as DevEnvironmentRunner;
      const browser = vi.fn(async () => ({ status: 'passed' as const, observed: 'Visible.', width: 1280, height: 800 }));
      const first = runBugScenario(f.store, runner, scenario.id, browser);
      await expect(runBugScenario(f.store, runner, scenario.id, browser)).rejects.toThrow('bereits eine Fehlerprüfung');
      expect(browser).not.toHaveBeenCalled();
      release(f.environment);
      expect((await first).status).toBe('passed');
      expect(browser).toHaveBeenCalledOnce();
      const failingRunner = { ...f.runner, verifyCurrentPreviewAsync: vi.fn()
        .mockRejectedValueOnce(new Error('preview unavailable')).mockResolvedValue(f.environment) } as DevEnvironmentRunner;
      await expect(runBugScenario(f.store, failingRunner, scenario.id, browser)).rejects.toThrow('preview unavailable');
      expect((await runBugScenario(f.store, failingRunner, scenario.id, browser)).status).toBe('passed');
      expect(browser).toHaveBeenCalledTimes(2);
      const changedDuringRun = await runBugScenario(f.store, f.runner, scenario.id, async () => {
        f.store.updateCard({ id: f.card.id, title: 'Updated while replay ran' });
        return { status: 'passed', observed: 'Visible.', width: 1280, height: 800 };
      });
      expect(changedDuringRun.status).toBe('error');
      expect(changedDuringRun.observed).toContain('änderten sich während');
    } finally { f.store.close(); }
  });
});
