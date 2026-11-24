import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureCardWorktree, mergeCardWorktree, reviewCardWorktree } from '../../src/main/git-worktree';
import { approveIntegration, enqueueIntegration, installIntegrationQueue, integrationQueue, prepareIntegration } from '../../src/main/integration-queue';
import { StudioStore } from '../../src/main/store';
import { createCardCriterion } from '../../src/main/card-acceptance';

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
  git(cwd, ['-c', 'user.name=Branchloom Test', '-c', 'user.email=branchloom-test@example.invalid', 'commit', '-qm', 'Synthetic change']);
  return git(cwd, ['rev-parse', 'HEAD']);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-integration-'));
  roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data');
  mkdirSync(repo); mkdirSync(data);
  git(repo, ['init', '-q']); commit(repo, 'base.txt', 'base');
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = (title: string) => store.createCard({ projectId: project.id, columnId, title });
  const finish = (cardId: string, file: string) => {
    const worktree = ensureCardWorktree(store, cardId);
    const session = store.createSession({ cardId, agentId: store.agents()[0]!.id, worktreePath: worktree.path });
    const head = commit(worktree.path, file, file);
    store.finishSession(session.id, 'exited', 0);
    return { worktree, head };
  };
  return { store, project, card, finish, repo, dbPath };
}

describe('persistent integration queue', () => {
  it('migrates an existing integration table before reserving an owner', () => {
    const { store } = fixture();
    try {
      store.db.exec(`DROP TABLE integration_items;
        CREATE TABLE integration_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, card_id TEXT NOT NULL UNIQUE,
          repository_key TEXT NOT NULL, target_branch TEXT NOT NULL, source_head TEXT NOT NULL,
          target_head TEXT NOT NULL, card_fingerprint TEXT NOT NULL, preview_token TEXT,
          state TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          integrated_head TEXT);`);
      installIntegrationQueue(store);
      const columns = store.db.prepare('PRAGMA table_info(integration_items)').all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === 'owner_pid')).toBe(true);
    } finally { store.close(); }
  });

  it('serializes two finished cards against the same target and blocks the stale second base', () => {
    const { store, project, card, finish, repo } = fixture();
    try {
      const first = card('Login'); const second = card('Navigation');
      const a = finish(first.id, 'login.txt'); const b = finish(second.id, 'navigation.txt');
      const independent = card('Independent work');
      const independentTree = ensureCardWorktree(store, independent.id);
      const running = store.createSession({ cardId: independent.id, agentId: store.agents()[0]!.id, worktreePath: independentTree.path });
      expect(enqueueIntegration(store, first.id).state).toBe('queued');
      expect(enqueueIntegration(store, second.id).state).toBe('queued');
      expect(integrationQueue(store, project.id).map((item) => item.cardId)).toEqual([first.id, second.id]);
      expect(prepareIntegration(store, second.id).state).toBe('ready');
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('earlier card');
      expect(prepareIntegration(store, first.id).state).toBe('ready');
      expect(() => approveIntegration(store, { cardId: first.id, confirm: false })).toThrow('approval');
      expect(approveIntegration(store, { cardId: first.id, confirm: true })).toMatchObject({ state: 'integrated', integratedHead: a.head });
      expect(store.session(running.id).state).toBe('running');
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(a.head);
      expect(prepareIntegration(store, second.id)).toMatchObject({ state: 'blocked' });
      expect(() => approveIntegration(store, { cardId: second.id, confirm: true })).toThrow('Prepare');
      expect(git(b.worktree.path, ['rev-parse', 'HEAD'])).toBe(b.head);
      expect(readFileSync(join(b.worktree.path, 'navigation.txt'), 'utf8')).toBe('navigation.txt');
      expect(existsSync(join(repo, 'navigation.txt'))).toBe(false);
      git(b.worktree.path, ['-c', 'user.name=Branchloom Test', '-c', 'user.email=branchloom-test@example.invalid', 'rebase', a.head]);
      expect(prepareIntegration(store, second.id).state).toBe('ready');
      expect(approveIntegration(store, { cardId: second.id, confirm: true }).state).toBe('integrated');
      expect(readFileSync(join(repo, 'login.txt'), 'utf8')).toBe('login.txt');
      expect(readFileSync(join(repo, 'navigation.txt'), 'utf8')).toBe('navigation.txt');
      store.finishSession(running.id, 'stopped', null);
    } finally { store.close(); }
  });

  it('rejects changed card revision and target head before a Git write', () => {
    const { store, card, finish, repo } = fixture();
    try {
      const task = card('First'); finish(task.id, 'feature.txt');
      enqueueIntegration(store, task.id);
      prepareIntegration(store, task.id);
      createCardCriterion(store, { cardId: task.id, text: 'The result handles an error.' });
      expect(() => approveIntegration(store, { cardId: task.id, confirm: true })).toThrow('Card changed');
      prepareIntegration(store, task.id);
      const newTarget = commit(repo, 'other.txt', 'other');
      expect(() => approveIntegration(store, { cardId: task.id, confirm: true })).toThrow('Git base');
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(newTarget);
      expect(prepareIntegration(store, task.id).state).toBe('blocked');
    } finally { store.close(); }
  });

  it('blocks a card when its latest saved browser QA failed', () => {
    const { store, card, finish, project } = fixture();
    try {
      const task = card('QA'); finish(task.id, 'qa.txt');
      enqueueIntegration(store, task.id);
      const now = new Date().toISOString();
      store.db.prepare(`INSERT INTO card_qa_reports
        (id, card_id, project_id, requested_url, started_at, ended_at, status, diagnostics_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('failed-qa', task.id, project.id, 'http://127.0.0.1:3000', now, now, 'failed', '[]');
      expect(prepareIntegration(store, task.id)).toMatchObject({ state: 'blocked', reason: 'The latest saved browser QA report failed. Review it before integration.' });
      expect(() => approveIntegration(store, { cardId: task.id, confirm: true })).toThrow('Prepare');
    } finally { store.close(); }
  });

  it('reconciles a Git success after restart instead of repeating the merge', () => {
    const { store, dbPath, project, card, finish, repo } = fixture();
    const task = card('Interrupted'); const source = finish(task.id, 'recovered.txt');
    enqueueIntegration(store, task.id); prepareIntegration(store, task.id);
    const preview = reviewCardWorktree(store, task.id)!;
    store.db.prepare("UPDATE integration_items SET state = 'integrating' WHERE card_id = ?").run(task.id);
    mergeCardWorktree(store, { cardId: task.id, previewToken: preview.previewToken, confirm: true });
    mkdirSync(join(repo, 'nested'));
    const otherProject = store.createProject({ name: 'Nested project', path: join(repo, 'nested') });
    store.close();
    const reopened = new StudioStore(dbPath);
    try {
      expect(integrationQueue(reopened, otherProject.id)).toEqual([]);
      const item = integrationQueue(reopened, project.id)[0]!;
      expect(item).toMatchObject({ state: 'integrated', sourceHead: source.head, integratedHead: source.head });
      expect(() => approveIntegration(reopened, { cardId: task.id, confirm: true })).toThrow('Prepare');
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(source.head);
    } finally { reopened.close(); }
  });

  it('persists a target lock across a second database connection', () => {
    const { store, dbPath, card, finish } = fixture();
    const a = card('A'); const b = card('B'); finish(a.id, 'a.txt'); finish(b.id, 'b.txt');
    enqueueIntegration(store, a.id); enqueueIntegration(store, b.id);
    prepareIntegration(store, a.id); prepareIntegration(store, b.id);
    store.db.prepare("UPDATE integration_items SET state = 'integrating' WHERE card_id = ?").run(a.id);
    const second = new StudioStore(dbPath);
    try {
      // Startup does not replay a pending write. The unique lock belongs to the repository/branch, not a workflow.
      expect(() => second.db.prepare("UPDATE integration_items SET state = 'integrating' WHERE card_id = ?").run(b.id)).toThrow();
      expect(integrationQueue(second, second.card(a.id).projectId)[0]!.state).toBe('blocked');
    } finally { second.close(); store.close(); }
  });

  it('does not release a live process lock when another app connection reads the queue', () => {
    const { store, dbPath, card, finish } = fixture();
    const first = card('First'); const secondCard = card('Second');
    finish(first.id, 'first.txt'); finish(secondCard.id, 'second.txt');
    enqueueIntegration(store, first.id); enqueueIntegration(store, secondCard.id);
    prepareIntegration(store, first.id); prepareIntegration(store, secondCard.id);
    store.db.prepare("UPDATE integration_items SET state = 'integrating', owner_pid = ? WHERE card_id = ?")
      .run(process.pid, first.id);
    const other = new StudioStore(dbPath);
    try {
      expect(integrationQueue(other, other.card(first.id).projectId)[0]!.state).toBe('integrating');
      expect(() => approveIntegration(other, { cardId: secondCard.id, confirm: true })).toThrow('earlier card');
      expect(other.db.prepare('SELECT owner_pid FROM integration_items WHERE card_id = ?').get(first.id))
        .toMatchObject({ owner_pid: process.pid });
    } finally { other.close(); store.close(); }
  });

  it('recovers a completed merge from the saved target branch after the card worktree is missing', () => {
    const { store, dbPath, card, finish, repo } = fixture();
    const task = card('Completed'); const source = finish(task.id, 'feature.txt');
    enqueueIntegration(store, task.id); prepareIntegration(store, task.id);
    const preview = reviewCardWorktree(store, task.id)!;
    store.db.prepare("UPDATE integration_items SET state = 'integrating' WHERE card_id = ?").run(task.id);
    mergeCardWorktree(store, { cardId: task.id, previewToken: preview.previewToken, confirm: true });
    git(repo, ['switch', '-q', '-c', 'another-branch']);
    rmSync(source.worktree.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    store.close();
    const reopened = new StudioStore(dbPath);
    try {
      expect(integrationQueue(reopened, reopened.card(task.id).projectId)[0]).toMatchObject({
        state: 'integrated', integratedHead: source.head,
      });
    } finally { reopened.close(); }
  });
});
