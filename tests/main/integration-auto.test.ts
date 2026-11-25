import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attestIntegrationReview, runIntegrationTest, setIntegrationTestScript } from '../../src/main/integration-evidence';
import { advanceAutomaticIntegrations, enqueueIntegration, integrationPolicy, integrationQueue, prepareIntegration, setIntegrationPolicy } from '../../src/main/integration-queue';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { setProjectRunPause } from '../../src/main/project-pause';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}
function commit(cwd: string, file: string, text: string): string {
  writeFileSync(join(cwd, file), text);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=Branchloom Test', '-c', 'user.email=branchloom-test@example.invalid', 'commit', '-qm', 'Synthetic change']);
  return git(cwd, ['rev-parse', 'HEAD']);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-integration-auto-'));
  roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data');
  mkdirSync(repo); mkdirSync(data); git(repo, ['init', '-q']);
  commit(repo, 'package.json', JSON.stringify({ name: 'synthetic-integration-auto', version: '1.0.0',
    scripts: { verify: 'node -e "process.stdout.write(\'AUTO_TEST_OK\\n\')"' } }));
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  function completedCard(name: string, file: string) {
    const card = store.createCard({ projectId: project.id, columnId, title: name });
    const tree = ensureCardWorktree(store, card.id);
    const session = store.createSession({ cardId: card.id, agentId: store.agents()[0]!.id, worktreePath: tree.path });
    const head = commit(tree.path, file, name);
    store.finishSession(session.id, 'exited', 0);
    enqueueIntegration(store, card.id);
    prepareIntegration(store, card.id);
    return { card, tree, head };
  }
  return { store, project, repo, dbPath, completedCard };
}

describe('opt-in automatic integration', () => {
  it('defaults to manual, requires a configured test and explicit consent, and persists disablement', () => {
    const f = fixture();
    try {
      expect(integrationPolicy(f.store, f.project.id).mode).toBe('manual');
      expect(() => setIntegrationPolicy(f.store, { projectId: f.project.id, mode: 'automatic', confirm: true })).toThrow('Configure');
      setIntegrationTestScript(f.store, { projectId: f.project.id, scriptName: 'verify' });
      expect(() => setIntegrationPolicy(f.store, { projectId: f.project.id, mode: 'automatic', confirm: false })).toThrow('consent');
      expect(setIntegrationPolicy(f.store, { projectId: f.project.id, mode: 'automatic', confirm: true }).mode).toBe('automatic');
      expect(() => setIntegrationTestScript(f.store, { projectId: f.project.id, scriptName: '' })).toThrow('Disable');
      f.store.close();
      const reopened = new StudioStore(f.dbPath);
      try {
        expect(integrationPolicy(reopened, f.project.id).mode).toBe('automatic');
        expect(setIntegrationPolicy(reopened, { projectId: f.project.id, mode: 'manual', confirm: false }).mode).toBe('manual');
      } finally { reopened.close(); }
    } finally { if (f.store.db.open) f.store.close(); }
  });

  it('merges only after exact human review and passing npm test, then records and deduplicates the result', async () => {
    const f = fixture();
    try {
      const first = f.completedCard('Login', 'login.txt');
      const original = git(f.repo, ['rev-parse', 'HEAD']);
      setIntegrationTestScript(f.store, { projectId: f.project.id, scriptName: 'verify' });
      expect(advanceAutomaticIntegrations(f.store)).toEqual([]);
      setIntegrationPolicy(f.store, { projectId: f.project.id, mode: 'automatic', confirm: true });
      expect(advanceAutomaticIntegrations(f.store)).toEqual([]);
      attestIntegrationReview(f.store, { cardId: first.card.id, confirm: true });
      expect(advanceAutomaticIntegrations(f.store)).toEqual([]);
      expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(original);
      const test = await runIntegrationTest(f.store, first.card.id);
      expect(test).toMatchObject({ state: 'passed', current: true });
      f.store.db.prepare(`INSERT INTO manual_file_revisions
        (id, card_id, project_id, path, base_head, target_branch, target_head, target_hash, manual_text, base_text, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('synthetic-manual-revision', first.card.id, f.project.id, 'login.txt', original, git(f.repo, ['branch', '--show-current']), original,
          'synthetic-hash', 'local text', '', new Date().toISOString());
      expect(advanceAutomaticIntegrations(f.store)).toEqual([]);
      expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(original);
      f.store.db.prepare('DELETE FROM manual_file_revisions WHERE id = ?').run('synthetic-manual-revision');
      setIntegrationPolicy(f.store, { projectId: f.project.id, mode: 'manual', confirm: false });
      expect(advanceAutomaticIntegrations(f.store)).toEqual([]);
      expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(original);
      setIntegrationPolicy(f.store, { projectId: f.project.id, mode: 'automatic', confirm: true });
      expect(advanceAutomaticIntegrations(f.store)).toMatchObject([{ cardId: first.card.id, state: 'integrated',
        integratedHead: first.head, approvalMode: 'automatic' }]);
      expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(first.head);
      f.store.close();
      const reopened = new StudioStore(f.dbPath);
      try {
        expect(integrationQueue(reopened, f.project.id)[0]).toMatchObject({ state: 'integrated', approvalMode: 'automatic' });
        expect(advanceAutomaticIntegrations(reopened)).toEqual([]);
        expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(first.head);
      } finally { reopened.close(); }
    } finally { if (f.store.db.open) f.store.close(); }
  });

  it('respects project pause and does not skip an earlier card with a stale base', async () => {
    const f = fixture();
    try {
      const first = f.completedCard('Login', 'login.txt');
      const second = f.completedCard('Navigation', 'navigation.txt');
      setIntegrationTestScript(f.store, { projectId: f.project.id, scriptName: 'verify' });
      setIntegrationPolicy(f.store, { projectId: f.project.id, mode: 'automatic', confirm: true });
      attestIntegrationReview(f.store, { cardId: first.card.id, confirm: true });
      await runIntegrationTest(f.store, first.card.id);
      attestIntegrationReview(f.store, { cardId: second.card.id, confirm: true });
      await runIntegrationTest(f.store, second.card.id);
      const original = git(f.repo, ['rev-parse', 'HEAD']);
      setProjectRunPause(f.store, { projectId: f.project.id, paused: true });
      expect(advanceAutomaticIntegrations(f.store)).toEqual([]);
      expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(original);
      setProjectRunPause(f.store, { projectId: f.project.id, paused: false });
      expect(advanceAutomaticIntegrations(f.store)).toMatchObject([{ cardId: first.card.id, integratedHead: first.head }]);
      expect(advanceAutomaticIntegrations(f.store)).toEqual([]);
      expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(first.head);
      expect(git(second.tree.path, ['rev-parse', 'HEAD'])).toBe(second.head);
    } finally { f.store.close(); }
  });
});
