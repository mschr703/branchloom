import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ensureCardWorktree, mergeCardWorktree, reviewCardWorktree, verifiedCardWorktreePath } from '../../src/main/git-worktree';
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
  git(cwd, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Synthetic change']);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-merge-'));
  roots.push(root);
  const repository = join(root, 'repo');
  const data = join(root, 'app-data');
  mkdirSync(repository); mkdirSync(data);
  git(repository, ['init', '-q']);
  commit(repository, 'tracked.txt', 'base');
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: repository });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Merge test' });
  return { store, dbPath, project, card, repository };
}

describe('reviewed worktree fast-forward', () => {
  it('opens only a saved, verified checkout for the requested project and card', () => {
    const { store, project, card } = fixture();
    expect(verifiedCardWorktreePath(store, { projectId: project.id, cardId: card.id })).toBeNull();
    const worktree = ensureCardWorktree(store, card.id);
    expect(verifiedCardWorktreePath(store, { projectId: project.id, cardId: card.id })).toBe(worktree.path);
    expect(() => verifiedCardWorktreePath(store, { projectId: 'unrelated-project', cardId: card.id })).toThrow('gewählten Projekt');
    git(worktree.path, ['checkout', '--detach', '-q']);
    expect(() => verifiedCardWorktreePath(store, { projectId: project.id, cardId: card.id })).toThrow('Karten-Branch');
    store.close();
  });
  it('reviews without creating a worktree, then shows uncommitted and committed changes', () => {
    const { store, card } = fixture();
    expect(reviewCardWorktree(store, card.id)).toBeNull();
    expect(store.cardWorktree(card.id)).toBeNull();
    const worktree = ensureCardWorktree(store, card.id);
    writeFileSync(join(worktree.path, 'draft.txt'), 'uncommitted');
    const dirty = reviewCardWorktree(store, card.id)!;
    expect(dirty.sourceStatus.join('\n')).toContain('draft.txt');
    expect(dirty.canFastForward).toBe(false);
    expect(dirty.blockers.join(' ')).toContain('nicht committete');
    commit(worktree.path, 'draft.txt', 'committed');
    const ready = reviewCardWorktree(store, card.id)!;
    expect(ready.sourceStatus).toEqual([]);
    expect(ready.committedStat).toContain('draft.txt');
    expect(ready).toMatchObject({ ahead: 1, behind: 0, canFastForward: true, branch: worktree.branch });
    store.close();
  });

  it('merges only with explicit, current confirmation and keeps worktree and branch', () => {
    const { store, dbPath, card, repository } = fixture();
    const worktree = ensureCardWorktree(store, card.id);
    const sourceHead = commit(worktree.path, 'new.txt', 'reviewed content');
    const preview = reviewCardWorktree(store, card.id)!;
    expect(preview.canFastForward).toBe(true);
    expect(() => mergeCardWorktree(store, { cardId: card.id, previewToken: preview.previewToken, confirm: false })).toThrow('Bestätigung');
    expect(git(repository, ['rev-parse', 'HEAD'])).toBe(preview.targetHead);
    const result = mergeCardWorktree(store, { cardId: card.id, previewToken: preview.previewToken, confirm: true });
    expect(git(repository, ['rev-parse', 'HEAD'])).toBe(sourceHead);
    expect(readFileSync(join(repository, 'new.txt'), 'utf8')).toBe('reviewed content');
    expect(existsSync(worktree.path)).toBe(true);
    expect(git(worktree.path, ['branch', '--show-current'])).toBe(worktree.branch);
    expect(result.canFastForward).toBe(false);
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reviewCardWorktree(reopened, card.id)?.targetHead).toBe(sourceHead);
    reopened.close();
  });

  it('rejects diverged branches and stale previews without changing either checkout', () => {
    const { store, card, repository } = fixture();
    const worktree = ensureCardWorktree(store, card.id);
    const sourceHead = commit(worktree.path, 'source.txt', 'source');
    const preview = reviewCardWorktree(store, card.id)!;
    const targetHead = commit(repository, 'target.txt', 'target');
    expect(() => mergeCardWorktree(store, { cardId: card.id, previewToken: preview.previewToken, confirm: true })).toThrow('Vorschau geändert');
    const diverged = reviewCardWorktree(store, card.id)!;
    expect(diverged).toMatchObject({ ahead: 1, behind: 1, canFastForward: false });
    expect(diverged.blockers.join(' ')).toContain('auseinander');
    expect(() => mergeCardWorktree(store, { cardId: card.id, previewToken: diverged.previewToken, confirm: true })).toThrow('Fast-Forward nicht möglich');
    expect(git(repository, ['rev-parse', 'HEAD'])).toBe(targetHead);
    expect(git(worktree.path, ['rev-parse', 'HEAD'])).toBe(sourceHead);
    expect(readFileSync(join(repository, 'target.txt'), 'utf8')).toBe('target');
    expect(readFileSync(join(worktree.path, 'source.txt'), 'utf8')).toBe('source');
    store.close();
  });

  it('blocks dirty targets, ignored path collisions, active sessions, and detached targets', () => {
    const { store, card, repository } = fixture();
    const worktree = ensureCardWorktree(store, card.id);
    commit(worktree.path, 'source.txt', 'source');
    writeFileSync(join(repository, 'tracked.txt'), 'local edit');
    writeFileSync(join(repository, 'untracked.txt'), 'keep');
    const dirty = reviewCardWorktree(store, card.id)!;
    expect(dirty.canFastForward).toBe(false);
    expect(dirty.targetStatus.join('\n')).toContain('untracked.txt');
    expect(() => mergeCardWorktree(store, { cardId: card.id, previewToken: dirty.previewToken, confirm: true })).toThrow('Fast-Forward nicht möglich');
    expect(readFileSync(join(repository, 'tracked.txt'), 'utf8')).toBe('local edit');
    writeFileSync(join(repository, 'tracked.txt'), 'base');
    unlinkSync(join(repository, 'untracked.txt'));
    const exclude = git(repository, ['rev-parse', '--git-path', 'info/exclude']);
    appendFileSync(isAbsolute(exclude) ? exclude : join(repository, exclude), '\nsource.txt\n');
    writeFileSync(join(repository, 'source.txt'), 'ignored local content');
    const ignoredCollision = reviewCardWorktree(store, card.id)!;
    expect(ignoredCollision.targetStatus).toEqual([]);
    expect(ignoredCollision.blockers.join(' ')).toContain('überdecken');
    unlinkSync(join(repository, 'source.txt'));
    git(worktree.path, ['mv', 'tracked.txt', 'renamed.txt']);
    git(worktree.path, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Rename tracked file']);
    appendFileSync(isAbsolute(exclude) ? exclude : join(repository, exclude), '\nrenamed.txt\n');
    writeFileSync(join(repository, 'renamed.txt'), 'ignored target content');
    const renamedCollision = reviewCardWorktree(store, card.id)!;
    expect(renamedCollision.targetStatus).toEqual([]);
    expect(renamedCollision.blockers.join(' ')).toContain('überdecken');
    unlinkSync(join(repository, 'renamed.txt'));
    const agent = store.agents()[0]!;
    const active = store.createSession({ cardId: card.id, agentId: agent.id });
    expect(reviewCardWorktree(store, card.id)?.blockers.join(' ')).toContain('läuft noch');
    store.finishSession(active.id, 'stopped', null);
    git(repository, ['checkout', '--detach']);
    expect(reviewCardWorktree(store, card.id)?.blockers.join(' ')).toContain('keinen aktiven Branch');
    store.close();
  }, 240_000);
});
