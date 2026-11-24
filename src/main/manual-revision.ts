import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ManualMergePreview, ManualRevision } from '../shared/manual-revision';
import { reviewCardWorktree } from './git-worktree';
import type { StudioStore } from './store';

const MAX_TEXT = 128 * 1024;
const hash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const stamp = (): string => new Date().toISOString();

interface Row {
  id: string; card_id: string; project_id: string; path: string; base_head: string; target_branch: string; target_head: string;
  target_hash: string; manual_text: string; base_text: string; captured_at: string; applied_at: string | null; applied_hash: string | null;
}

const publicRow = (row: Row): ManualRevision => ({ id: row.id, cardId: row.card_id, projectId: row.project_id,
  path: row.path, baseHead: row.base_head, targetBranch: row.target_branch, targetHead: row.target_head, targetHash: row.target_hash,
  capturedAt: row.captured_at, appliedAt: row.applied_at, appliedHash: row.applied_hash });

export function installManualRevisions(store: StudioStore): void {
  store.db.exec(`CREATE TABLE IF NOT EXISTS manual_file_revisions (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL, base_head TEXT NOT NULL, target_branch TEXT NOT NULL, target_head TEXT NOT NULL,
    target_hash TEXT NOT NULL, manual_text TEXT NOT NULL, base_text TEXT NOT NULL,
    captured_at TEXT NOT NULL, applied_at TEXT, applied_hash TEXT);
    CREATE INDEX IF NOT EXISTS idx_manual_file_revisions_card ON manual_file_revisions(card_id, captured_at DESC);`);
}

function git(cwd: string, args: string[]): Buffer {
  const result = spawnSync('git', args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 512 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.error || result.status !== 0)
    throw new Error('Git could not read or compare the selected file.');
  return result.stdout;
}

function safePath(root: string, path: string): string {
  if (!path || path.length > 400 || path.includes('\\') || path.includes('\0') || isAbsolute(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Choose a tracked project file.');
  const target = resolve(root, path);
  const part = relative(realpathSync(root), realpathSync(target));
  if (part === '..' || part.startsWith('../') || part.startsWith('..\\') || isAbsolute(part) || !lstatSync(target).isFile()
    || lstatSync(target).isSymbolicLink()) throw new Error('The selected file is not a regular file inside this project.');
  return target;
}

function textFile(value: Buffer): string {
  if (value.length > MAX_TEXT || value.includes(0) || (value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf))
    throw new Error('This first comparison supports UTF-8 text files up to 128 KiB without a byte-order mark.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); }
  catch { throw new Error('The selected file is not valid UTF-8 text.'); }
}

function committedText(root: string, head: string, path: string): string {
  const tree = git(root, ['ls-tree', '-z', head, '--', path]).toString('utf8');
  if (!/^(100644|100755) blob [a-f0-9]{40,64}\t/u.test(tree))
    throw new Error('The file must be a regular tracked file in both committed versions.');
  return textFile(git(root, ['show', `${head}:${path}`]));
}

function mergeBase(root: string, targetHead: string, sourceHead: string): string {
  const base = git(root, ['merge-base', targetHead, sourceHead]).toString('utf8').trim();
  if (!/^[a-f0-9]{40,64}$/u.test(base)) throw new Error('The branches have no verifiable common base.');
  return base;
}

function row(store: StudioStore, id: string): Row {
  const found = store.db.prepare('SELECT * FROM manual_file_revisions WHERE id = ?').get(id) as Row | undefined;
  if (!found) throw new Error('Manual revision was not found.');
  store.card(found.card_id);
  return found;
}

function compareText(base: string, manual: string, agent: string): { combined: string; hasConflicts: boolean } {
  const folder = mkdtempSync(join(tmpdir(), 'branchloom-manual-merge-'));
  const ours = join(folder, 'manual'); const ancestor = join(folder, 'base'); const theirs = join(folder, 'agent');
  try {
    writeFileSync(ours, manual); writeFileSync(ancestor, base); writeFileSync(theirs, agent);
    const result = spawnSync('git', ['merge-file', '-p', '--diff3', '-L', 'Manual', '-L', 'Common base', '-L', 'Agent', ours, ancestor, theirs],
      { windowsHide: true, timeout: 30_000, maxBuffer: 512 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (result.error || result.status === null || result.status < 0 || result.status > 127
      || (result.status > 0 && !result.stdout?.length))
      throw new Error('Git could not make the three-way comparison.');
    return { combined: textFile(result.stdout), hasConflicts: result.status > 0 };
  } finally {
    for (const file of [ours, ancestor, theirs]) { try { unlinkSync(file); } catch { /* Temporary comparison cleanup only. */ } }
    rmdirSync(folder);
  }
}

export function manualRevisionFiles(store: StudioStore, cardId: string): string[] {
  store.card(cardId);
  const review = reviewCardWorktree(store, cardId);
  if (!review) return [];
  return git(review.targetPath, ['-c', 'core.fsmonitor=false', 'diff', 'HEAD', '--name-only', '--diff-filter=M', '-z', '--'])
    .toString('utf8').split('\0').filter(Boolean).slice(0, 100).filter((path) => { try { safePath(review.targetPath, path); return true; } catch { return false; } });
}

export function manualRevisions(store: StudioStore, cardId: string): ManualRevision[] {
  store.card(cardId);
  return (store.db.prepare('SELECT * FROM manual_file_revisions WHERE card_id = ? ORDER BY captured_at DESC, rowid DESC LIMIT 20')
    .all(cardId) as Row[]).map(publicRow);
}

/** A capture records user intent, not authorship inferred from file timestamps. */
export function captureManualRevision(store: StudioStore, input: { cardId: string; path: string }): ManualRevision {
  const card = store.card(input.cardId);
  const review = reviewCardWorktree(store, card.id);
  if (!review || !review.targetBranch)
    throw new Error('A saved card worktree and active target branch are required.');
  if (!manualRevisionFiles(store, card.id).includes(input.path)) throw new Error('Choose a modified tracked text file.');
  const target = safePath(review.targetPath, input.path);
  const manualBytes = readFileSync(target);
  const manual = textFile(manualBytes);
  const baseHead = mergeBase(review.targetPath, review.targetHead, review.sourceHead);
  const base = committedText(review.targetPath, baseHead, input.path);
  committedText(review.path, review.sourceHead, input.path);
  const id = randomUUID();
  const capturedAt = stamp();
  store.db.prepare(`INSERT INTO manual_file_revisions
    (id, card_id, project_id, path, base_head, target_branch, target_head, target_hash, manual_text, base_text, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, card.id, card.projectId, input.path, baseHead,
      review.targetBranch, review.targetHead, hash(manualBytes), manual, base, capturedAt);
  return publicRow(row(store, id));
}

export function previewManualRevision(store: StudioStore, id: string): ManualMergePreview {
  const saved = row(store, id);
  const review = reviewCardWorktree(store, saved.card_id);
  if (!review || review.path === review.targetPath) throw new Error('The card worktree is unavailable.');
  const agent = committedText(review.path, review.sourceHead, saved.path);
  const comparison = compareText(saved.base_text, saved.manual_text, agent);
  let staleReason: string | null = null;
  if (saved.applied_at) staleReason = 'This manual revision was already applied.';
  else if (review.targetBranch !== saved.target_branch || review.targetHead !== saved.target_head)
    staleReason = 'Target branch or HEAD changed since capture. Capture a new revision.';
  else if (mergeBase(review.targetPath, saved.target_head, review.sourceHead) !== saved.base_head)
    staleReason = 'The shared Git base changed. Capture a new revision.';
  else if (review.sourceStatus.length) staleReason = 'The card worktree has uncommitted changes. Commit it before applying.';
  else {
    try {
      if (hash(readFileSync(safePath(review.targetPath, saved.path))) !== saved.target_hash)
        staleReason = 'Target file changed since capture. Capture a new revision.';
    } catch { staleReason = 'Target file is unavailable. Capture a new revision.'; }
  }
  const previewToken = hash(JSON.stringify([saved.id, saved.base_head, saved.target_branch, saved.target_head, saved.target_hash,
    review.sourceHead, hash(comparison.combined), staleReason]));
  return { revision: publicRow(saved), sourceHead: review.sourceHead, targetHead: review.targetHead,
    base: saved.base_text, manual: saved.manual_text, agent, ...comparison, staleReason, previewToken };
}

/** Applies only a conflict-free, fresh single-file result; it does not merge Git branches. */
export function applyManualRevision(store: StudioStore, input: { revisionId: string; previewToken: string; confirm: boolean }): ManualRevision {
  if (input.confirm !== true) throw new Error('Explicit confirmation is required.');
  return store.db.transaction(() => {
    const preview = previewManualRevision(store, input.revisionId);
    if (preview.previewToken !== input.previewToken || preview.staleReason)
      throw new Error('The comparison is stale. Refresh it before applying.');
    if (preview.hasConflicts) throw new Error('Overlapping changes need a separate resolution; no file was written.');
    const review = reviewCardWorktree(store, preview.revision.cardId);
    if (!review || review.targetBranch !== preview.revision.targetBranch || review.targetHead !== preview.targetHead || review.sourceHead !== preview.sourceHead)
      throw new Error('Git changed since the comparison. Refresh it before applying.');
    const target = safePath(review.targetPath, preview.revision.path);
    const original = readFileSync(target);
    if (hash(original) !== preview.revision.targetHash) throw new Error('Target file changed; no file was written.');
    const temporary = join(dirname(target), `.branchloom-manual-${randomUUID()}.tmp`);
    const handle = openSync(temporary, 'wx', lstatSync(target).mode);
    try {
      try { writeFileSync(handle, preview.combined, 'utf8'); fsyncSync(handle); }
      finally { closeSync(handle); }
      if (hash(readFileSync(safePath(review.targetPath, preview.revision.path))) !== preview.revision.targetHash)
        throw new Error('Target file changed during preparation; no file was written.');
      renameSync(temporary, target);
    } finally { try { unlinkSync(temporary); } catch { /* Renamed or failed temporary file. */ } }
    const appliedAt = stamp();
    store.db.prepare('UPDATE manual_file_revisions SET applied_at = ?, applied_hash = ? WHERE id = ? AND applied_at IS NULL')
      .run(appliedAt, hash(preview.combined), preview.revision.id);
    return publicRow(row(store, preview.revision.id));
  }).immediate();
}
