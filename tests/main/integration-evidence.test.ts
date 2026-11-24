import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attestIntegrationReview, integrationEvidence, runIntegrationTest, setIntegrationTestScript } from '../../src/main/integration-evidence';
import { approveIntegration, enqueueIntegration, prepareIntegration } from '../../src/main/integration-queue';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { createCardCriterion } from '../../src/main/card-acceptance';
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
function fixture(script = 'node -e "process.stdout.write(\'verified\\n\')"') {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-integration-evidence-'));
  roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data');
  mkdirSync(repo); mkdirSync(data);
  git(repo, ['init', '-q']);
  commit(repo, 'package.json', JSON.stringify({ name: 'synthetic-integration', version: '1.0.0', scripts: { verify: script } }));
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = store.createCard({ projectId: project.id, columnId, title: 'Feature' });
  const tree = ensureCardWorktree(store, card.id);
  const session = store.createSession({ cardId: card.id, agentId: store.agents()[0]!.id, worktreePath: tree.path });
  const sourceHead = commit(tree.path, 'feature.txt', 'feature');
  store.finishSession(session.id, 'exited', 0);
  enqueueIntegration(store, card.id);
  prepareIntegration(store, card.id);
  return { store, project, card, tree, sourceHead, repo, dbPath };
}

describe('commit-bound integration evidence', () => {
  it('runs a configured npm script in an isolated checkout and gates the manual merge', async () => {
    const { store, project, card, tree, sourceHead, repo } = fixture();
    try {
      setIntegrationTestScript(store, { projectId: project.id, scriptName: 'verify' });
      expect(() => approveIntegration(store, { cardId: card.id, confirm: true })).toThrow('Review');
      attestIntegrationReview(store, { cardId: card.id, confirm: true });
      expect(() => approveIntegration(store, { cardId: card.id, confirm: true })).toThrow('configured test');
      const test = await runIntegrationTest(store, card.id);
      expect(test).toMatchObject({ state: 'passed', current: true, sourceHead, scriptName: 'verify', exitCode: 0 });
      expect(test.outputTail).toContain('verified');
      expect(git(tree.path, ['status', '--porcelain'])).toBe('');
      expect(approveIntegration(store, { cardId: card.id, confirm: true }).state).toBe('integrated');
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(sourceHead);
    } finally { store.close(); }
  });

  it('keeps failed and source-mutating scripts from passing the gate', async () => {
    for (const [script, state] of [
      ['node -e "process.exit(2)"', 'failed'],
      ['node -e "require(\'fs\').writeFileSync(\'extra.txt\', \'changed\')"', 'stale'],
    ]) {
      const { store, project, card } = fixture(script);
      try {
        setIntegrationTestScript(store, { projectId: project.id, scriptName: 'verify' });
        attestIntegrationReview(store, { cardId: card.id, confirm: true });
        expect((await runIntegrationTest(store, card.id)).state).toBe(state);
        expect(() => approveIntegration(store, { cardId: card.id, confirm: true })).toThrow('configured test');
      } finally { store.close(); }
    }
  });

  it('invalidates review and test on changed card or target without repeating the test', async () => {
    const { store, project, card, repo } = fixture();
    try {
      setIntegrationTestScript(store, { projectId: project.id, scriptName: 'verify' });
      attestIntegrationReview(store, { cardId: card.id, confirm: true });
      await runIntegrationTest(store, card.id);
      createCardCriterion(store, { cardId: card.id, text: 'An error state is visible.' });
      expect(integrationEvidence(store, card.id).test?.current).toBe(false);
      expect(integrationEvidence(store, card.id).review?.current).toBe(false);
      prepareIntegration(store, card.id);
      expect(() => approveIntegration(store, { cardId: card.id, confirm: true })).toThrow('Review');
      attestIntegrationReview(store, { cardId: card.id, confirm: true });
      expect(() => approveIntegration(store, { cardId: card.id, confirm: true })).toThrow('configured test');
      commit(repo, 'other.txt', 'other');
      expect(integrationEvidence(store, card.id).review?.current).toBe(false);
    } finally { store.close(); }
  });

  it('marks an orphaned running test interrupted after restart and never replays it', () => {
    const { store, project, card, dbPath } = fixture();
    setIntegrationTestScript(store, { projectId: project.id, scriptName: 'verify' });
    const item = store.db.prepare('SELECT id, source_head, target_head, card_fingerprint FROM integration_items WHERE card_id = ?').get(card.id) as {
      id: number; source_head: string; target_head: string; card_fingerprint: string;
    };
    store.db.prepare(`INSERT INTO integration_test_runs (item_id, card_id, source_head, target_head, card_fingerprint, script_name, script_hash,
      state, exit_code, output_tail, started_at, ended_at, owner_pid) VALUES (?, ?, ?, ?, ?, 'verify', 'hash', 'running', NULL, '', ?, NULL, NULL)`)
      .run(item.id, card.id, item.source_head, item.target_head, item.card_fingerprint, new Date().toISOString());
    store.close();
    const reopened = new StudioStore(dbPath);
    try {
      expect(integrationEvidence(reopened, card.id).test?.state).toBe('interrupted');
      expect(() => approveIntegration(reopened, { cardId: card.id, confirm: true })).toThrow('Review');
    } finally { reopened.close(); }
  });

  it('does not merge while a test is running even if its project script is cleared', () => {
    const { store, project, card, repo } = fixture();
    try {
      attestIntegrationReview(store, { cardId: card.id, confirm: true });
      const item = store.db.prepare('SELECT id, source_head, target_head, card_fingerprint FROM integration_items WHERE card_id = ?').get(card.id) as {
        id: number; source_head: string; target_head: string; card_fingerprint: string;
      };
      store.db.prepare(`INSERT INTO integration_test_runs (item_id, card_id, source_head, target_head, card_fingerprint, script_name, script_hash,
        state, exit_code, output_tail, started_at, ended_at, owner_pid) VALUES (?, ?, ?, ?, ?, 'verify', 'hash', 'running', NULL, '', ?, NULL, ?)`)
        .run(item.id, card.id, item.source_head, item.target_head, item.card_fingerprint, new Date().toISOString(), process.pid);
      setIntegrationTestScript(store, { projectId: project.id, scriptName: '' });
      const before = git(repo, ['rev-parse', 'HEAD']);
      expect(() => approveIntegration(store, { cardId: card.id, confirm: true })).toThrow('still running');
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(before);
    } finally { store.close(); }
  });

  it('times out a long script and keeps its result blocked', async () => {
    const { store, project, card } = fixture('node -e "setTimeout(() => process.exit(0), 5000)"');
    try {
      setIntegrationTestScript(store, { projectId: project.id, scriptName: 'verify' });
      attestIntegrationReview(store, { cardId: card.id, confirm: true });
      const result = await runIntegrationTest(store, card.id, 150);
      expect(result.state).not.toBe('passed');
      expect(result.outputTail).toContain('timed out');
      expect(() => approveIntegration(store, { cardId: card.id, confirm: true })).toThrow('configured test');
    } finally { store.close(); }
  });
});
