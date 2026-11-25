import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attestIntegrationReview, runIntegrationTest, setIntegrationTestScript } from '../../src/main/integration-evidence';
import { approveIntegration, enqueueIntegration, prepareIntegration } from '../../src/main/integration-queue';
import { integrationResultFolder } from '../../src/main/integration-results';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { StudioStore } from '../../src/main/store';
import { integrationResultsMarkdown } from '../../src/shared/integration-results';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}
function commit(cwd: string, file: string, content: string): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'Synthetic change']);
  return git(cwd, ['rev-parse', 'HEAD']);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-integration-results-'));
  roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data');
  mkdirSync(repo); mkdirSync(data); git(repo, ['init', '-q']);
  const base = commit(repo, 'package.json', JSON.stringify({ name: 'synthetic-results', version: '1.0.0',
    scripts: { verify: 'node -e "process.stdout.write(\'RESULT_TEST_OK\\n\')"' } }));
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic results', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const finish = (title: string, file: string) => {
    const card = store.createCard({ projectId: project.id, columnId, title });
    const tree = ensureCardWorktree(store, card.id);
    const session = store.createSession({ cardId: card.id, agentId: store.agents()[0]!.id, worktreePath: tree.path });
    const head = commit(tree.path, file, title);
    store.finishSession(session.id, 'exited', 0);
    enqueueIntegration(store, card.id);
    return { card, tree, head };
  };
  return { store, project, repo, dbPath, base, finish };
}

describe('integration result folder', () => {
  it('shows real merged and blocked outcomes, saved evidence, restart, and a later target rewind', async () => {
    const f = fixture();
    const first = f.finish('Login', 'login.txt');
    const second = f.finish('Navigation', 'navigation.txt');
    try {
      prepareIntegration(f.store, first.card.id);
      attestIntegrationReview(f.store, { cardId: first.card.id, confirm: true });
      setIntegrationTestScript(f.store, { projectId: f.project.id, scriptName: 'verify' });
      expect((await runIntegrationTest(f.store, first.card.id)).state).toBe('passed');
      expect(approveIntegration(f.store, { cardId: first.card.id, confirm: true }).state).toBe('integrated');
      expect(prepareIntegration(f.store, second.card.id).state).toBe('blocked');
      const firstRead = integrationResultFolder(f.store, f.project.id);
      expect(firstRead.entries).toHaveLength(2);
      expect(firstRead.entries[0]).toMatchObject({ title: 'Login', state: 'integrated', sourceHead: first.head,
        integratedHead: first.head, approvalMode: 'manual', gitPresence: 'present', currentTargetHead: first.head,
        review: { matchesSavedSnapshot: true }, test: { state: 'passed', matchesSavedSnapshot: true, exitCode: 0 } });
      expect(firstRead.entries[1]).toMatchObject({ title: 'Navigation', state: 'blocked', sourceHead: second.head,
        integratedHead: null, gitPresence: null });
      expect(firstRead.entries[1]!.reason).toMatch(/diverg|fast.forward|base/iu);
      expect(integrationResultsMarkdown(firstRead)).toContain('## Offen');
      expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(first.head);
      f.store.close();
      const reopened = new StudioStore(f.dbPath);
      try {
        expect(integrationResultFolder(reopened, f.project.id).entries[0]!.gitPresence).toBe('present');
        git(f.repo, ['reset', '--hard', f.base]);
        const afterRewind = integrationResultFolder(reopened, f.project.id);
        expect(afterRewind.entries[0]).toMatchObject({ state: 'integrated', gitPresence: 'missing', currentTargetHead: f.base });
        reopened.db.prepare('UPDATE integration_items SET repository_key = ? WHERE card_id = ?')
          .run('synthetic-different-repository', first.card.id);
        expect(integrationResultFolder(reopened, f.project.id).entries[0]!.gitPresence).toBe('unverified');
        expect(git(first.tree.path, ['rev-parse', 'HEAD'])).toBe(first.head);
        expect(git(second.tree.path, ['rev-parse', 'HEAD'])).toBe(second.head);
      } finally { reopened.close(); }
    } finally { if (f.store.db.open) f.store.close(); }
  });

  it('escapes card titles and blockers in copied Markdown', () => {
    const f = fixture();
    try {
      const card = f.finish('Review | **fake**', 'change.txt');
      f.store.db.prepare("UPDATE integration_items SET state = 'blocked', reason = ? WHERE card_id = ?")
        .run('Needs review\n## injected', card.card.id);
      const markdown = integrationResultsMarkdown(integrationResultFolder(f.store, f.project.id));
      expect(markdown).toContain('Review \\| \\*\\*fake\\*\\*');
      expect(markdown).toContain('Needs review ## injected');
      expect(markdown).not.toContain('\n## injected');
      expect(git(f.repo, ['rev-parse', 'HEAD'])).toBe(f.base);
    } finally { f.store.close(); }
  });
});
