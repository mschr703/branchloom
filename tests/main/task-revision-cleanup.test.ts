import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { previewTaskRevisionCleanup } from '../../src/main/task-revision-cleanup';
import { confirmTaskRevision, taskRevisionHistory } from '../../src/main/task-revisions';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'branchloom-task-cleanup-'))) throw new Error('Unexpected test cleanup path.');
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-task-cleanup-')); roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data'); mkdirSync(repo); mkdirSync(data);
  git(repo, 'init', '-q'); mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'export.ts'), "export const formats = ['CSV'];\n");
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'base');
  const db = join(data, 'studio.sqlite');
  const store = new StudioStore(db); stores.push(store);
  const project = store.createProject({ name: 'Synthetic export', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
    title: 'Export CSV and PDF', description: 'Build CSV and PDF formats.' });
  const change = () => confirmTaskRevision(store, { projectId: project.id, cardId: card.id,
    expectedContentRevision: taskRevisionHistory(store, { projectId: project.id, cardId: card.id }).contentRevision,
    title: 'Export CSV', description: 'Build CSV formats.', reason: 'PDF is out of scope.' }).revisions[0]!;
  return { root, repo, db, store, project, card, change };
}

describe('task revision cleanup preview', () => {
  it('shows lexical scope cues without claiming a code match when no worktree exists, including after restart', () => {
    const f = fixture();
    const revision = f.change();
    const preview = previewTaskRevisionCleanup(f.store, { projectId: f.project.id, cardId: f.card.id, revisionId: revision.id });
    expect(preview.oldOnly.some((cue) => cue.term === 'PDF' && cue.source === 'title')).toBe(true);
    expect(preview.retained).toContain('CSV');
    expect(preview.source).toBeNull();
    expect(preview.matches).toEqual([]);
    f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    const reopened = new StudioStore(f.db); stores.push(reopened);
    expect(previewTaskRevisionCleanup(reopened, { projectId: f.project.id, cardId: f.card.id,
      revisionId: revision.id }).oldOnly).toEqual(preview.oldOnly);
  });

  it('links a removed cue to a bounded changed source line and refreshes after an edit without writing', () => {
    const f = fixture();
    const worktree = ensureCardWorktree(f.store, f.card.id);
    const source = join(worktree.path, 'src', 'export.ts');
    writeFileSync(source, "export const formats = ['CSV', 'PDF'];\n");
    git(worktree.path, 'add', 'src/export.ts');
    git(worktree.path, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'add PDF');
    const head = git(worktree.path, 'rev-parse', 'HEAD');
    const revision = f.change();
    const first = previewTaskRevisionCleanup(f.store, { projectId: f.project.id, cardId: f.card.id, revisionId: revision.id });
    expect(first.source).toMatchObject({ head, changedFileCount: 1, inspectedFileCount: 1, worktreeDirty: false, truncated: false });
    expect(first.matches).toMatchObject([{ term: 'PDF', path: 'src/export.ts', line: 1 }]);
    expect(first.matches[0]?.excerpt).toContain("'PDF'");
    expect(readFileSync(source, 'utf8')).toBe("export const formats = ['CSV', 'PDF'];\n");
    expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(head);
    writeFileSync(source, "// PDF review target\nexport const formats = ['CSV', 'PDF'];\n");
    const second = previewTaskRevisionCleanup(f.store, { projectId: f.project.id, cardId: f.card.id, revisionId: revision.id });
    expect(second.source?.worktreeDirty).toBe(true);
    expect(second.matches[0]?.line).toBe(1);
    expect(second.matches[0]?.fileHash).not.toBe(first.matches[0]?.fileHash);
    expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(head);
    writeFileSync(join(worktree.path, 'src', 'untracked.ts'), '// PDF remains here, but is untracked.\n');
    const secret = 'sk-' + 'a'.repeat(24);
    writeFileSync(source, `// PDF ${secret}\nexport const formats = ['CSV', 'PDF'];\n`);
    const masked = previewTaskRevisionCleanup(f.store, { projectId: f.project.id, cardId: f.card.id, revisionId: revision.id });
    expect(masked.source?.changedFileCount).toBe(1);
    expect(masked.matches.some((match) => match.path === 'src/untracked.ts')).toBe(false);
    expect(masked.matches[0]?.excerpt).toContain('[ausgeblendet: API-Schlüssel]');
    expect(masked.matches[0]?.excerpt).not.toContain(secret);
    f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    const reopened = new StudioStore(f.db); stores.push(reopened);
    expect(previewTaskRevisionCleanup(reopened, { projectId: f.project.id, cardId: f.card.id,
      revisionId: revision.id }).matches[0]?.fileHash).toBe(masked.matches[0]?.fileHash);
  });

  it('rejects a stale or cross-project revision before inspecting source files', () => {
    const f = fixture();
    const revision = f.change();
    expect(() => previewTaskRevisionCleanup(f.store, { projectId: 'other', cardId: f.card.id,
      revisionId: revision.id })).toThrow('another project');
    f.store.updateCard({ id: f.card.id, description: 'A later scope edit.' });
    expect(() => previewTaskRevisionCleanup(f.store, { projectId: f.project.id, cardId: f.card.id,
      revisionId: revision.id })).toThrow('no longer current');
  });
});
