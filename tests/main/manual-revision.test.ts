import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCardWorktree, reviewCardWorktree } from '../../src/main/git-worktree';
import { applyManualRevision, captureManualRevision, manualRevisionFiles, manualRevisions, previewManualRevision } from '../../src/main/manual-revision';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) {
    if (dirname(realpathSync(root)) !== realpathSync(tmpdir()) || !basename(root).startsWith('branchloom-manual-revision-'))
      throw new Error('Unexpected test cleanup target.');
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-manual-revision-')); roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data'); mkdirSync(repo); mkdirSync(data);
  git(repo, 'init', '-q');
  const base = 'title=Old\nspacing=8\nlabel=Name\nhelper=Enter a name\nwidth=320\ncolor=neutral\nfocus=visible\naria=required\nvalidation=none\n';
  writeFileSync(join(repo, 'form.txt'), base);
  git(repo, 'add', 'form.txt');
  git(repo, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'base');
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath); stores.push(store);
  const project = store.createProject({ name: 'Synthetic form', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = store.createCard({ projectId: project.id, columnId, title: 'Improve form' });
  const worktree = ensureCardWorktree(store, card.id);
  return { root, repo, dbPath, store, project, card, worktree, base };
}

function commitAgent(worktree: string, content: string) {
  writeFileSync(join(worktree, 'form.txt'), content);
  git(worktree, 'add', 'form.txt');
  git(worktree, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'agent change');
}

describe('manual file revisions', () => {
  it('captures an explicit target revision and applies non-overlapping agent edits to one file', () => {
    const { store, card, repo, worktree, base } = fixture();
    commitAgent(worktree.path, base.replace('validation=none', 'validation=required'));
    writeFileSync(join(repo, 'form.txt'), base.replace('title=Old', 'title=Clear').replace('spacing=8', 'spacing=12'));
    expect(manualRevisionFiles(store, card.id)).toEqual(['form.txt']);
    const revision = captureManualRevision(store, { cardId: card.id, path: 'form.txt' });
    const preview = previewManualRevision(store, revision.id);
    expect(preview.hasConflicts).toBe(false);
    expect(preview.combined).toBe(base.replace('title=Old', 'title=Clear').replace('spacing=8', 'spacing=12').replace('validation=none', 'validation=required'));
    expect(preview.staleReason).toBeNull();
    expect(() => applyManualRevision(store, { revisionId: revision.id, previewToken: preview.previewToken, confirm: false })).toThrow('Explicit');
    expect(applyManualRevision(store, { revisionId: revision.id, previewToken: preview.previewToken, confirm: true }).appliedAt).toBeTruthy();
    expect(readFileSync(join(repo, 'form.txt'), 'utf8')).toBe(preview.combined);
    expect(reviewCardWorktree(store, card.id)?.targetStatus).toContain(' M form.txt');
    expect(() => applyManualRevision(store, { revisionId: revision.id, previewToken: preview.previewToken, confirm: true })).toThrow('stale');
  });

  it('detects a target edit between preview and click without writing the older result', () => {
    const { store, card, repo, worktree, base } = fixture();
    commitAgent(worktree.path, base.replace('validation=none', 'validation=required'));
    writeFileSync(join(repo, 'form.txt'), base.replace('title=Old', 'title=Clear'));
    const revision = captureManualRevision(store, { cardId: card.id, path: 'form.txt' });
    const preview = previewManualRevision(store, revision.id);
    const newer = base.replace('title=Old', 'title=Clearer');
    writeFileSync(join(repo, 'form.txt'), newer);
    expect(previewManualRevision(store, revision.id).staleReason).toContain('Target file changed');
    expect(() => applyManualRevision(store, { revisionId: revision.id, previewToken: preview.previewToken, confirm: true })).toThrow('stale');
    expect(readFileSync(join(repo, 'form.txt'), 'utf8')).toBe(newer);
  });

  it('shows base and both variants for an overlap and refuses to write', () => {
    const { store, card, repo, worktree, base } = fixture();
    commitAgent(worktree.path, base.replace('title=Old', 'title=Agent'));
    const manual = base.replace('title=Old', 'title=Maxim');
    writeFileSync(join(repo, 'form.txt'), manual);
    const revision = captureManualRevision(store, { cardId: card.id, path: 'form.txt' });
    const preview = previewManualRevision(store, revision.id);
    expect(preview).toMatchObject({ base, manual, agent: base.replace('title=Old', 'title=Agent'), hasConflicts: true });
    expect(preview.combined).toContain('<<<<<<< Manual');
    expect(() => applyManualRevision(store, { revisionId: revision.id, previewToken: preview.previewToken, confirm: true })).toThrow('Overlapping');
    expect(readFileSync(join(repo, 'form.txt'), 'utf8')).toBe(manual);
  });

  it('keeps the captured revision after restart and refuses non-text or untracked files', () => {
    const { store, card, repo, worktree, dbPath, base } = fixture();
    commitAgent(worktree.path, base.replace('validation=none', 'validation=required'));
    writeFileSync(join(repo, 'form.txt'), base.replace('title=Old', 'title=Clear'));
    writeFileSync(join(repo, 'other.txt'), 'untracked');
    expect(() => captureManualRevision(store, { cardId: card.id, path: 'other.txt' })).toThrow('modified tracked');
    writeFileSync(join(repo, 'form.txt'), Buffer.from([0, 1, 2]));
    expect(() => captureManualRevision(store, { cardId: card.id, path: 'form.txt' })).toThrow('UTF-8');
    writeFileSync(join(repo, 'form.txt'), base.replace('title=Old', 'title=Clear'));
    const revision = captureManualRevision(store, { cardId: card.id, path: 'form.txt' });
    store.close(); stores.splice(stores.indexOf(store), 1);
    const reopened = new StudioStore(dbPath); stores.push(reopened);
    expect(manualRevisions(reopened, card.id)[0]?.id).toBe(revision.id);
    expect(previewManualRevision(reopened, revision.id).manual).toContain('title=Clear');
  });

  it('refuses an old preview after the agent commit changes', () => {
    const { store, card, repo, worktree, base } = fixture();
    commitAgent(worktree.path, base.replace('validation=none', 'validation=required'));
    const manual = base.replace('title=Old', 'title=Clear');
    writeFileSync(join(repo, 'form.txt'), manual);
    const revision = captureManualRevision(store, { cardId: card.id, path: 'form.txt' });
    const preview = previewManualRevision(store, revision.id);
    commitAgent(worktree.path, base.replace('validation=none', 'validation=strict'));
    expect(() => applyManualRevision(store, { revisionId: revision.id, previewToken: preview.previewToken, confirm: true })).toThrow('stale');
    expect(readFileSync(join(repo, 'form.txt'), 'utf8')).toBe(manual);
  });
});
