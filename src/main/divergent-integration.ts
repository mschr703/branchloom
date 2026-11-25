import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import type { DivergentIntegration } from '../shared/divergent-integration';
import { reviewCardWorktree, worktreeRepositoryKey } from './git-worktree';
import { assertProjectCanStart } from './project-pause';
import type { StudioStore } from './store';

interface AttemptRow {
  item_id: number; card_id: string; path: string; branch: string; original_source_head: string;
  target_head: string; target_branch: string; repository_key: string; card_fingerprint: string;
}

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const commitHash = /^[a-f0-9]{40,64}$/u;

function git(cwd: string, args: string[], acceptConflict = false, raw = false): { output: string; status: number } {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'rerere.enabled=false', ...args], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || (result.status !== 0 && !(acceptConflict && result.status === 1)))
    throw new Error(`Integration worktree: ${String(result.stderr || result.error?.message || 'Git failed').trim().slice(0, 500)}`);
  return { output: raw ? result.stdout : result.stdout.trim(), status: result.status ?? -1 };
}

function inside(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === '' || (part !== '..' && !part.startsWith('..\\') && !part.startsWith('../') && !isAbsolute(part));
}

function samePath(first: string, second: string): boolean {
  const left = realpathSync(first);
  const right = realpathSync(second);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function rowForCard(store: StudioStore, cardId: string): AttemptRow | undefined {
  return store.db.prepare('SELECT * FROM divergent_integration_attempts WHERE card_id = ?').get(cardId) as AttemptRow | undefined;
}

export function installDivergentIntegration(store: StudioStore): void {
  store.db.exec(`CREATE TABLE IF NOT EXISTS divergent_integration_attempts (
    item_id INTEGER PRIMARY KEY REFERENCES integration_items(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL,
    original_source_head TEXT NOT NULL, target_head TEXT NOT NULL, target_branch TEXT NOT NULL,
    repository_key TEXT NOT NULL, card_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
}

/** An attempt belongs to a fixed original source and target snapshot. Never repurpose its path or branch. */
export function divergentIntegration(store: StudioStore, cardId: string): DivergentIntegration | null {
  store.card(cardId);
  const row = rowForCard(store, cardId);
  if (!row) return null;
  const missing = (reason: string): DivergentIntegration => ({ cardId, path: row.path, branch: row.branch,
    originalSourceHead: row.original_source_head, targetHead: row.target_head, resultHead: null,
    conflicts: [], state: 'missing', reason });
  let base: string;
  try { base = realpathSync(store.worktreeBase); }
  catch { return missing('The app-owned worktree directory is missing. No Git action was retried.'); }
  const project = store.project(store.card(cardId).projectId);
  const expected = join(base, project.id, `integration-${row.item_id}-${cardId}`);
  let targetRoot: string;
  try { targetRoot = realpathSync(git(project.path, ['rev-parse', '--show-toplevel']).output); }
  catch { return missing('The target repository cannot be verified.'); }
  if (row.path !== expected || !inside(base, row.path) || inside(targetRoot, row.path))
    return missing('The saved integration path is outside the app-owned worktree directory.');
  if (!existsSync(row.path)) return missing('The assigned integration worktree is missing. No Git action was retried.');
  if (lstatSync(row.path).isSymbolicLink()) return missing('The assigned integration path was replaced by a link.');
  try {
    if ((process.platform === 'win32' ? realpathSync(row.path).toLowerCase() !== row.path.toLowerCase() : realpathSync(row.path) !== row.path)
      || !samePath(git(row.path, ['rev-parse', '--show-toplevel']).output, row.path)
      || worktreeRepositoryKey(row.path) !== row.repository_key
      || git(row.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).output !== row.branch)
      return missing('The assigned worktree no longer matches its saved repository and branch.');
    const head = git(row.path, ['rev-parse', 'HEAD']).output;
    const savedItem = store.db.prepare('SELECT state, integrated_head FROM integration_items WHERE id = ?').get(row.item_id) as
      { state: string; integrated_head: string | null } | undefined;
    if (savedItem?.state === 'integrated' && savedItem.integrated_head === head) {
      const currentTarget = git(project.path, ['rev-parse', '--verify', `refs/heads/${row.target_branch}`]).output;
      const stillPresent = git(project.path, ['merge-base', '--is-ancestor', head, currentTarget], true).status === 0;
      return { cardId, path: row.path, branch: row.branch, originalSourceHead: row.original_source_head,
        targetHead: row.target_head, resultHead: head, conflicts: [], state: stillPresent ? 'integrated' : 'stale',
        reason: stillPresent ? null : 'The recorded result is no longer present in the current target branch.' };
    }
    const marker = git(row.path, ['rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD']).output;
    const conflicts = git(row.path, ['diff', '--name-only', '--diff-filter=U', '-z'], false, true).output.split('\0').filter(Boolean).slice(0, 100);
    if (existsSync(marker)) return { cardId, path: row.path, branch: row.branch,
      originalSourceHead: row.original_source_head, targetHead: row.target_head, resultHead: null,
      conflicts, state: 'merging', reason: conflicts.length
        ? 'Resolve the listed conflicts, then stage and commit in this integration worktree.'
        : 'The merge is staged. Review and commit it in this integration worktree.' };
    const original = reviewCardWorktree(store, cardId);
    const target = git(project.path, ['rev-parse', '--verify', `refs/heads/${row.target_branch}`]).output;
    const currentBranch = git(project.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).output;
    const clean = !git(row.path, ['status', '--porcelain', '--untracked-files=all']).output;
    const sourceIncluded = git(row.path, ['merge-base', '--is-ancestor', row.original_source_head, head], true).status === 0;
    const targetIncluded = git(row.path, ['merge-base', '--is-ancestor', row.target_head, head], true).status === 0;
    const addedPaths = git(row.path, ['diff', '--no-renames', '--name-only', '-z', '--diff-filter=A', `${row.target_head}..${head}`], false, true)
      .output.split('\0').filter(Boolean);
    const overlapsLocalFile = Boolean(original && addedPaths.some((file) => {
      const destination = join(original.targetPath, file);
      return inside(original.targetPath, destination) && existsSync(destination);
    }));
    const unchanged = original?.sourceHead === row.original_source_head && original?.targetBranch === row.target_branch
      && original.blockers.length === 1 && original.blockers[0]?.startsWith('Branches sind auseinander')
      && worktreeRepositoryKey(original.targetPath) === row.repository_key && target === row.target_head
      && currentBranch === row.target_branch && !overlapsLocalFile;
    const ready = head !== row.target_head && commitHash.test(head) && clean && sourceIncluded && targetIncluded && unchanged;
    return { cardId, path: row.path, branch: row.branch, originalSourceHead: row.original_source_head,
      targetHead: row.target_head, resultHead: ready ? head : null, conflicts: [],
      state: ready ? 'ready' : 'stale', reason: ready ? null
        : !unchanged ? 'The original card, target, or a local ignored file changed. This attempt is retained but cannot be integrated.'
          : !clean ? 'Commit or remove changes in the integration worktree before review.'
            : 'The result must contain both the original source and target commits.' };
  } catch (error) { return missing(error instanceof Error ? error.message : 'The assigned worktree could not be verified.'); }
}

/** Create a bounded, dedicated checkout and start a non-committing merge. No source or target checkout is edited. */
function createDivergentIntegration(store: StudioStore, cardId: string, retryMissing: boolean): DivergentIntegration {
  const queued = store.db.prepare('SELECT * FROM integration_items WHERE card_id = ?').get(cardId) as {
    id: number; state: string; repository_key: string; target_branch: string; source_head: string;
    target_head: string; card_fingerprint: string;
  } | undefined;
  if (!queued || queued.state !== 'blocked') throw new Error('Prepare the blocked queue card before creating an integration worktree.');
  const existing = rowForCard(store, cardId);
  if (existing && !retryMissing) return divergentIntegration(store, cardId)!;
  if (!existing && retryMissing) throw new Error('There is no saved integration attempt to retry.');
  const card = store.card(cardId);
  assertProjectCanStart(store, card.projectId);
  const revision = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(cardId) as { content_revision: number };
  if (sha([revision.content_revision, card]) !== queued.card_fingerprint)
    throw new Error('Card changed since preparation. Prepare again.');
  const lastRun = store.db.prepare('SELECT state, exit_code, worktree_path FROM sessions WHERE card_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1')
    .get(cardId) as { state: string; exit_code: number | null; worktree_path: string | null } | undefined;
  const lastQa = store.db.prepare('SELECT status FROM card_qa_reports WHERE card_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(cardId) as { status: string } | undefined;
  const earlier = store.db.prepare(`SELECT id FROM integration_items WHERE repository_key = ? AND target_branch = ?
    AND id < ? AND state IN ('queued','ready','blocked','integrating') LIMIT 1`)
    .get(queued.repository_key, queued.target_branch, queued.id);
  if (earlier) throw new Error('An earlier card is waiting for this target branch.');
  const review = reviewCardWorktree(store, cardId);
  if (!review || review.behind < 1 || review.ahead < 1 || !review.targetBranch
    || review.blockers.length !== 1 || !review.blockers[0]?.startsWith('Branches sind auseinander')
    || review.targetBranch !== queued.target_branch || review.targetHead !== queued.target_head
    || review.sourceHead !== queued.source_head || worktreeRepositoryKey(review.targetPath) !== queued.repository_key)
    throw new Error('Only a clean, unchanged divergent source and target can start an integration worktree.');
  if (lastRun?.state !== 'exited' || lastRun.exit_code !== 0 || lastRun.worktree_path !== review.path
    || (lastQa && lastQa.status !== 'passed'))
    throw new Error('The latest card run or browser QA changed. Prepare again.');
  const project = store.project(store.card(cardId).projectId);
  const parent = join(store.worktreeBase, project.id);
  mkdirSync(parent, { recursive: true });
  const parentReal = realpathSync(parent);
  const targetReal = realpathSync(review.targetPath);
  if (lstatSync(store.worktreeBase).isSymbolicLink() || lstatSync(parent).isSymbolicLink() || inside(targetReal, parentReal))
    throw new Error('The integration directory points inside the target repository.');
  const path = join(parentReal, `integration-${queued.id}-${cardId}`);
  const branch = `branchloom/integration-${queued.id}-${cardId}`;
  if (existing && (existing.item_id !== queued.id || existing.path !== path || existing.branch !== branch
    || existing.original_source_head !== queued.source_head || existing.target_head !== queued.target_head
    || existing.card_fingerprint !== queued.card_fingerprint || divergentIntegration(store, cardId)?.state !== 'missing'))
    throw new Error('The saved attempt changed or is not safely retryable. No Git data was changed.');
  if (existsSync(path)) throw new Error('The integration path already exists. No existing files were changed.');
  if (git(review.targetPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], true).status === 0)
    throw new Error('The assigned integration branch already exists. No existing Git ref was changed.');
  if (!existing) store.db.prepare(`INSERT INTO divergent_integration_attempts
    (item_id, card_id, path, branch, original_source_head, target_head, target_branch, repository_key, card_fingerprint, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(queued.id, cardId, path, branch, queued.source_head,
    queued.target_head, queued.target_branch, queued.repository_key, queued.card_fingerprint, new Date().toISOString());
  // The row is durable before Git writes. A crash cannot silently create a second attempt.
  const hooks = mkdtempSync(join(tmpdir(), 'branchloom-merge-hooks-'));
  try {
    git(review.targetPath, ['-c', `core.hooksPath=${hooks}`, 'worktree', 'add', '-b', branch, '--', path, queued.target_head]);
    const merge = git(path, ['-c', `core.hooksPath=${hooks}`, 'merge', '--no-commit', '--no-ff', '--no-edit', queued.source_head], true);
    if (merge.status === 1) {
      const marker = git(path, ['rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD']).output;
      if (!existsSync(marker)) throw new Error('Git merge failed without a resumable conflict state. The worktree was preserved.');
    }
  } finally { try { rmdirSync(hooks); } catch { /* Only an empty app-owned hooks directory is removed. */ } }
  return divergentIntegration(store, cardId)!;
}

export function startDivergentIntegration(store: StudioStore, cardId: string): DivergentIntegration {
  return createDivergentIntegration(store, cardId, false);
}

/** Retry only a crash-before-checkout with both the generated path and ref absent. */
export function retryMissingDivergentIntegration(store: StudioStore, cardId: string): DivergentIntegration {
  return createDivergentIntegration(store, cardId, true);
}

export function divergentIntegrationDiff(store: StudioStore, cardId: string): string {
  const attempt = divergentIntegration(store, cardId);
  if (!attempt || attempt.state !== 'ready' || !attempt.resultHead) throw new Error('Commit the verified integration result before opening its final diff.');
  return git(attempt.path, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', attempt.targetHead, attempt.resultHead]).output.slice(0, 100_000);
}

export function divergentPreviewToken(cardId: string, sourceHead: string, targetBranch: string, targetHead: string): string {
  return sha([cardId, 'divergent-result', sourceHead, targetBranch, targetHead]);
}

/** Last write remains ff-only, with Git's own target-head guard and no forced update. */
export function mergeDivergentIntegration(store: StudioStore, cardId: string, sourceHead: string, targetHead: string): void {
  const attempt = divergentIntegration(store, cardId);
  if (!attempt || attempt.state !== 'ready' || attempt.resultHead !== sourceHead || attempt.targetHead !== targetHead)
    throw new Error('Integration result changed before the Git write. Review and test again.');
  const target = store.project(store.card(cardId).projectId).path;
  const saved = rowForCard(store, cardId);
  if (!saved || git(target, ['rev-parse', 'HEAD']).output !== targetHead
    || git(target, ['symbolic-ref', '--quiet', '--short', 'HEAD']).output !== saved.target_branch
    || git(target, ['status', '--porcelain', '--untracked-files=all']).output)
    throw new Error('Target branch or checkout changed immediately before integration. Review and test again.');
  const hooks = mkdtempSync(join(tmpdir(), 'branchloom-merge-hooks-'));
  try { git(target, ['-c', `core.hooksPath=${hooks}`, 'merge', '--ff-only', sourceHead]); }
  finally { try { rmdirSync(hooks); } catch { /* Only an empty app-owned hooks directory is removed. */ } }
  if (git(target, ['rev-parse', 'HEAD']).output !== sourceHead)
    throw new Error('Git did not report the expected integration result at target HEAD.');
}
