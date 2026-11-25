import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { approveIntegration, enqueueIntegration, prepareIntegration } from '../../src/main/integration-queue';
import { divergentIntegration, divergentIntegrationDiff, retryMissingDivergentIntegration, startDivergentIntegration } from '../../src/main/divergent-integration';
import { attestIntegrationReview, runIntegrationTest, setIntegrationTestScript } from '../../src/main/integration-evidence';
import { createCardCriterion } from '../../src/main/card-acceptance';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const repo = join(root, 'repo');
    if (existsSync(repo)) {
      const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8', windowsHide: true });
      for (const line of list.stdout?.split(/\r?\n/u) ?? []) {
        if (!line.startsWith('worktree ')) continue;
        const path = line.slice('worktree '.length);
        const part = relative(root, path);
        if (part && part !== 'repo' && part !== '..' && !part.startsWith('..\\') && !part.startsWith('../') && !isAbsolute(part))
          spawnSync('git', ['worktree', 'remove', '--force', '--', path], { cwd: repo, windowsHide: true, timeout: 30_000 });
      }
    }
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error; /* Windows can retain a synthetic Git handle briefly. */ }
  }
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}
function commit(cwd: string, file: string, body: string): string {
  writeFileSync(join(cwd, file), body);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=Branchloom Test', '-c', 'user.email=branchloom-test@example.invalid', 'commit', '-qm', 'Synthetic change']);
  return git(cwd, ['rev-parse', 'HEAD']);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-divergent-'));
  roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data');
  mkdirSync(repo); mkdirSync(data);
  git(repo, ['init', '-q']);
  commit(repo, 'package.json', JSON.stringify({ private: true, scripts: { test: 'node -e "process.exit(0)"' } }));
  commit(repo, 'shared.txt', 'base');
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = (title: string) => store.createCard({ projectId: project.id, columnId, title });
  const finish = (cardId: string, file: string, body: string) => {
    const tree = ensureCardWorktree(store, cardId);
    const session = store.createSession({ cardId, agentId: store.agents()[0]!.id, worktreePath: tree.path });
    const head = commit(tree.path, file, body);
    store.finishSession(session.id, 'exited', 0);
    return { tree, head };
  };
  return { root, repo, dbPath, store, project, card, finish };
}

describe('divergent integration worktree', () => {
  it('does not let a later ready card bypass an earlier blocked card on the same target', () => {
    const { repo, store, card, finish } = fixture();
    try {
      const base = git(repo, ['rev-parse', 'HEAD']);
      const first = card('First'); const second = card('Second');
      const firstRun = finish(first.id, 'first.txt', 'first'); finish(second.id, 'second.txt', 'second');
      enqueueIntegration(store, first.id); enqueueIntegration(store, second.id);
      writeFileSync(join(firstRun.tree.path, 'uncommitted.txt'), 'user work');
      expect(prepareIntegration(store, first.id).state).toBe('blocked');
      expect(prepareIntegration(store, second.id).state).toBe('ready');
      attestIntegrationReview(store, { cardId: second.id, confirm: true });
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('earlier card');
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(base);
      expect(readFileSync(join(firstRun.tree.path, 'uncommitted.txt'), 'utf8')).toBe('user work');
    } finally { store.close(); }
  }, 120_000);

  it('keeps both original branches and merges only a freshly reviewed and tested committed result', async () => {
    const { root, repo, dbPath, store, project, card, finish } = fixture();
    try {
      const first = card('First'); const second = card('Second');
      const a = finish(first.id, 'first.txt', 'first');
      const b = finish(second.id, 'second.txt', 'second');
      enqueueIntegration(store, first.id); enqueueIntegration(store, second.id);
      prepareIntegration(store, first.id);
      attestIntegrationReview(store, { cardId: first.id, confirm: true });
      approveIntegration(store, { cardId: first.id, confirm: true });
      expect(prepareIntegration(store, second.id).state).toBe('blocked');
      const configPath = join(root, 'empty-gitconfig');
      writeFileSync(configPath, '');
      const originalConfig = process.env.GIT_CONFIG_GLOBAL;
      const originalSystem = process.env.GIT_CONFIG_NOSYSTEM;
      const originalCommitterName = process.env.GIT_COMMITTER_NAME;
      const originalCommitterEmail = process.env.GIT_COMMITTER_EMAIL;
      let attempt: ReturnType<typeof startDivergentIntegration>;
      try {
        process.env.GIT_CONFIG_GLOBAL = configPath;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        delete process.env.GIT_COMMITTER_NAME;
        delete process.env.GIT_COMMITTER_EMAIL;
        attempt = startDivergentIntegration(store, second.id);
      } finally {
        if (originalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
        else process.env.GIT_CONFIG_GLOBAL = originalConfig;
        if (originalSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
        else process.env.GIT_CONFIG_NOSYSTEM = originalSystem;
        if (originalCommitterName === undefined) delete process.env.GIT_COMMITTER_NAME;
        else process.env.GIT_COMMITTER_NAME = originalCommitterName;
        if (originalCommitterEmail === undefined) delete process.env.GIT_COMMITTER_EMAIL;
        else process.env.GIT_COMMITTER_EMAIL = originalCommitterEmail;
      }
      expect(attempt.state, attempt.reason ?? 'No reason given').toBe('merging');
      expect(attempt).toMatchObject({ state: 'merging', originalSourceHead: b.head, targetHead: a.head, conflicts: [] });
      expect(existsSync(attempt.path)).toBe(true);
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(a.head);
      expect(git(b.tree.path, ['rev-parse', 'HEAD'])).toBe(b.head);
      expect(startDivergentIntegration(store, second.id).path).toBe(attempt.path);
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('Prepare');
      git(attempt.path, ['-c', 'user.name=Branchloom Test', '-c', 'user.email=branchloom-test@example.invalid', 'commit', '-qm', 'Merge reviewed changes']);
      const resultHead = git(attempt.path, ['rev-parse', 'HEAD']);
      expect(divergentIntegration(store, second.id)).toMatchObject({ state: 'ready', resultHead });
      expect(divergentIntegrationDiff(store, second.id)).toContain('second.txt');
      expect(prepareIntegration(store, second.id)).toMatchObject({ state: 'ready', sourceHead: resultHead });
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('Review');
      attestIntegrationReview(store, { cardId: second.id, confirm: true });
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('Configure and run');
      setIntegrationTestScript(store, { projectId: project.id, scriptName: 'test' });
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('Run the configured test');
      expect((await runIntegrationTest(store, second.id, 30_000)).state).toBe('passed');
      expect(approveIntegration(store, { cardId: second.id, confirm: true })).toMatchObject({ state: 'integrated', integratedHead: resultHead });
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(resultHead);
      expect(git(b.tree.path, ['rev-parse', 'HEAD'])).toBe(b.head);
      expect(readFileSync(join(repo, 'first.txt'), 'utf8')).toBe('first');
      expect(readFileSync(join(repo, 'second.txt'), 'utf8')).toBe('second');
      store.close();
      const reopened = new StudioStore(dbPath);
      try { expect(divergentIntegration(reopened, second.id)).toMatchObject({ state: 'integrated', resultHead }); }
      finally { reopened.close(); }
    } finally { try { store.close(); } catch { /* Already closed. */ } }
  }, 240_000);

  it('surfaces file conflicts and refuses changed card or target before any target write', () => {
    const { repo, store, card, finish } = fixture();
    try {
      const first = card('First'); const second = card('Second');
      const a = finish(first.id, 'shared.txt', 'first');
      const b = finish(second.id, 'shared.txt', 'second');
      enqueueIntegration(store, first.id); enqueueIntegration(store, second.id);
      prepareIntegration(store, first.id); attestIntegrationReview(store, { cardId: first.id, confirm: true });
      approveIntegration(store, { cardId: first.id, confirm: true });
      prepareIntegration(store, second.id);
      writeFileSync(join(repo, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf hook > hook-called\n');
      const attempt = startDivergentIntegration(store, second.id);
      expect(attempt.state, attempt.reason ?? 'No reason given').toBe('merging');
      expect(existsSync(join(attempt.path, 'hook-called'))).toBe(false);
      expect(attempt).toMatchObject({ state: 'merging', conflicts: ['shared.txt'] });
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(a.head);
      expect(git(b.tree.path, ['rev-parse', 'HEAD'])).toBe(b.head);
      commit(attempt.path, 'shared.txt', 'resolved');
      expect(prepareIntegration(store, second.id).state).toBe('ready');
      attestIntegrationReview(store, { cardId: second.id, confirm: true });
      createCardCriterion(store, { cardId: second.id, text: 'New requirement' });
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('Card changed');
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(a.head);
      prepareIntegration(store, second.id); attestIntegrationReview(store, { cardId: second.id, confirm: true });
      const newTarget = commit(repo, 'external.txt', 'external');
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('Git base');
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(newTarget);
      expect(divergentIntegration(store, second.id)?.state).toBe('stale');
    } finally { store.close(); }
  });

  it('preserves whitespace in ignored-file checks and retries only an absent assigned path and ref', () => {
    const { repo, store, card, finish } = fixture();
    try {
      const first = card('First'); const second = card('Second');
      finish(first.id, 'first.txt', 'first'); finish(second.id, 'second.txt', 'second');
      enqueueIntegration(store, first.id); enqueueIntegration(store, second.id);
      prepareIntegration(store, first.id); attestIntegrationReview(store, { cardId: first.id, confirm: true });
      approveIntegration(store, { cardId: first.id, confirm: true });
      prepareIntegration(store, second.id);
      writeFileSync(join(repo, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf hook > hook-called\n');
      const attempt = startDivergentIntegration(store, second.id);
      expect(attempt.state, attempt.reason ?? 'No reason given').toBe('merging');
      expect(() => retryMissingDivergentIntegration(store, second.id)).toThrow('not safely retryable');
      git(attempt.path, ['-c', 'user.name=Branchloom Test', '-c', 'user.email=branchloom-test@example.invalid', 'commit', '-qm', 'Merge reviewed changes']);
      commit(attempt.path, ' leading.txt', 'new result file');
      writeFileSync(join(repo, '.git', 'info', 'exclude'), '\n leading.txt\n');
      writeFileSync(join(repo, ' leading.txt'), 'private local file');
      expect(git(repo, ['status', '--porcelain'])).toBe('');
      expect(divergentIntegration(store, second.id)?.state).toBe('stale');
      expect(prepareIntegration(store, second.id).state).toBe('blocked');
      git(repo, ['worktree', 'remove', '--force', '--', attempt.path]);
      git(repo, ['branch', '-D', attempt.branch]);
      expect(divergentIntegration(store, second.id)?.state).toBe('missing');
      expect(retryMissingDivergentIntegration(store, second.id)).toMatchObject({ state: 'merging', path: attempt.path });
      expect(existsSync(join(attempt.path, 'hook-called'))).toBe(false);
      expect(git(repo, ['status', '--porcelain'])).toBe('');
    } finally { store.close(); }
  }, 240_000);
});
