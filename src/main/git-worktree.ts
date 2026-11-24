import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { WorktreeReview } from '../shared/types';
import type { WorktreeCleanupPreview } from '../shared/worktree-cleanup';
import type { CardWorktree, StudioStore } from './store';

function git(cwd: string, args: string[], timeout = 30_000): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || 'Git-Aufruf fehlgeschlagen').trim().slice(0, 500);
    throw new Error(`Git-Worktree: ${detail}`);
  }
  return result.stdout.trimEnd();
}

function within(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === '' || (part !== '..' && !part.startsWith(`..\\`) && !part.startsWith('../') && !isAbsolute(part));
}

function pathPresent(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function gitRoot(path: string): string {
  try { return realpathSync(git(path, ['rev-parse', '--show-toplevel'])); }
  catch { throw new Error('Für einen isolierten Worktree muss der Projektordner in einem Git-Repository liegen.'); }
}

function commonDir(path: string): string {
  const value = git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return realpathSync(value);
}

function sameDirectory(first: string, second: string): boolean {
  const left = statSync(first, { bigint: true });
  const right = statSync(second, { bigint: true });
  // Git can emit an 8.3 Windows path for one checkout and a long path for
  // another. File identity is more reliable than comparing their spellings.
  if (left.ino !== 0n && right.ino !== 0n) return left.dev === right.dev && left.ino === right.ino;
  const a = realpathSync.native(first);
  const b = realpathSync.native(second);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function verifyExisting(record: CardWorktree, sourceRoot: string, expectedPath: string): void {
  if (!existsSync(record.path) || lstatSync(record.path).isSymbolicLink() || !statSync(record.path).isDirectory()) throw new Error('Der gespeicherte Worktree fehlt oder wurde ersetzt. Keine Dateien wurden gelöscht.');
  if (!sameDirectory(record.sourceRoot, sourceRoot) || !sameDirectory(record.path, expectedPath)) throw new Error('Der gespeicherte Worktree gehört nicht mehr zu diesem Projekt.');
  if (!sameDirectory(gitRoot(record.path), record.path) || !sameDirectory(commonDir(record.path), commonDir(sourceRoot))) throw new Error('Der Worktree gehört zu einem anderen Git-Repository.');
  if (git(record.path, ['rev-parse', '--symbolic-full-name', 'HEAD']) !== `refs/heads/${record.branch}`) throw new Error('Der Worktree steht nicht mehr auf seinem Karten-Branch.');
}

/** Create or reuse an isolated, per-card checkout. Never remove a worktree or reset its branch. */
export function ensureCardWorktree(store: StudioStore, cardId: string): { path: string; cwd: string; branch: string } {
  const card = store.card(cardId);
  const project = store.project(card.projectId);
  const sourceRoot = gitRoot(project.path);
  git(sourceRoot, ['rev-parse', '--verify', 'HEAD']);
  const parent = join(store.worktreeBase, project.id);
  if (within(sourceRoot, parent)) throw new Error('Der Worktree-Speicherort liegt im Projekt-Repository.');
  mkdirSync(parent, { recursive: true });
  if (within(sourceRoot, realpathSync(parent))) throw new Error('Der Worktree-Speicherort verweist ins Projekt-Repository.');
  const path = join(parent, card.id);
  const branch = `jarvis/card-${card.id}`;
  const old = store.cardWorktree(card.id);
  if (old) verifyExisting(old, sourceRoot, path);
  else if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink()) throw new Error('Der Worktree-Pfad ist ein symbolischer Link.');
    // Recovery if Git completed checkout but the app stopped before recording it.
    verifyExisting({ cardId, projectId: project.id, sourceRoot, path, branch, createdAt: '' }, sourceRoot, path);
    store.saveCardWorktree({ cardId, projectId: project.id, sourceRoot, path, branch });
  } else {
    // Generated UUID path and branch, argument array, no shell and no -B/--force.
    // A failed checkout is left untouched so valuable partial files are not lost.
    git(sourceRoot, ['worktree', 'add', '-b', branch, path, 'HEAD'], 120_000);
    verifyExisting({ cardId, projectId: project.id, sourceRoot, path, branch, createdAt: '' }, sourceRoot, path);
    store.saveCardWorktree({ cardId, projectId: project.id, sourceRoot, path, branch });
  }
  // Git reports the repository-relative prefix regardless of whether Windows
  // spelled the project path with its 8.3 alias or its long directory name.
  const subdirectory = git(project.path, ['rev-parse', '--show-prefix']).replace(/[/\\]+$/, '');
  const cwd = join(path, subdirectory);
  if (!within(path, cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('Das Projekt-Unterverzeichnis fehlt im Worktree.');
  const realCwd = realpathSync(cwd);
  if (!within(realpathSync(path), realCwd)) throw new Error('Das Projekt-Unterverzeichnis verweist aus dem Worktree hinaus.');
  return { path, cwd: realCwd, branch };
}

/** Read only: missing worktrees are not silently created by opening a card. */
export function reviewCardWorktree(store: StudioStore, cardId: string): WorktreeReview | null {
  const record = store.cardWorktree(cardId);
  if (!record) { store.card(cardId); return null; }
  const project = store.project(record.projectId);
  const targetPath = gitRoot(project.path);
  verifyExisting(record, targetPath, join(store.worktreeBase, record.projectId, cardId));
  const sourceHead = git(record.path, ['rev-parse', 'HEAD']);
  const targetHead = git(targetPath, ['rev-parse', 'HEAD']);
  let targetBranch: string | null = null;
  try { targetBranch = git(targetPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']); } catch { /* Detached target. */ }
  const sourceStatusText = git(record.path, ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=true', 'status', '--porcelain=v1', '--untracked-files=all']);
  const targetStatusText = git(targetPath, ['-c', 'core.fsmonitor=false', '-c', 'core.quotePath=true', 'status', '--porcelain=v1', '--untracked-files=all']);
  const sourceStatus = sourceStatusText ? sourceStatusText.split(/\r?\n/).slice(0, 100) : [];
  const targetStatus = targetStatusText ? targetStatusText.split(/\r?\n/).slice(0, 100) : [];
  const uncommittedStat = git(record.path, ['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--stat']).slice(0, 6000);
  const counts = git(targetPath, ['rev-list', '--left-right', '--count', `${targetHead}...${sourceHead}`]).trim().split(/\s+/).map(Number);
  const behind = counts[0] ?? 0;
  const ahead = counts[1] ?? 0;
  let committedStat = '';
  try { committedStat = git(targetPath, ['diff', '--no-ext-diff', '--no-textconv', '--stat', `${targetHead}...${sourceHead}`]).slice(0, 6000); }
  catch { /* No common base; merge is blocked below. */ }
  const blockers: string[] = [];
  if (!targetBranch) blockers.push('Ziel-Checkout hat keinen aktiven Branch.');
  if (sourceStatusText) blockers.push('Worktree hat nicht committete Änderungen.');
  if (targetStatusText) blockers.push('Ziel-Checkout ist nicht sauber.');
  if (sourceHead === targetHead) blockers.push('Keine neuen Commits im Worktree.');
  if (behind > 0) blockers.push('Branches sind auseinander gelaufen; nur Fast-Forward ist erlaubt.');
  if (store.activeSessionForProject(record.projectId)) blockers.push('In diesem Projekt läuft noch ein Agent.');
  for (const [checkout, label] of [[targetPath, 'Ziel-Checkout'], [record.path, 'Worktree']] as const) {
    const gitDirectory = git(checkout, ['rev-parse', '--path-format=absolute', '--git-dir']);
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'index.lock']) {
      if (existsSync(join(gitDirectory, marker))) { blockers.push(`Im ${label} läuft bereits ein Git-Vorgang.`); break; }
    }
  }
  // Git status hides ignored paths. An added committed file must not replace
  // an ignored local file in the target checkout.
  // Treat renames as delete+add so an ignored target file at the new name is
  // checked exactly like any other newly committed path.
  const addedPaths = git(targetPath, ['diff', '--no-renames', '--name-only', '-z', '--diff-filter=A', `${targetHead}..${sourceHead}`]).split('\0').filter(Boolean);
  if (addedPaths.some((item) => within(targetPath, join(targetPath, item)) && pathPresent(join(targetPath, item)))) blockers.push('Ein neuer Commit-Pfad würde eine lokale Zieldatei überdecken.');
  const previewToken = createHash('sha256').update(JSON.stringify([cardId, record.branch, sourceHead, targetBranch, targetHead])).digest('hex');
  return { cardId, path: record.path, branch: record.branch, targetPath, targetBranch, sourceHead, targetHead, sourceStatus, targetStatus, uncommittedStat, committedStat, ahead, behind, canFastForward: blockers.length === 0 && ahead > 0, blockers, previewToken };
}

/** Return only an already saved checkout that still belongs to this project and card. */
export function verifiedCardWorktreePath(store: StudioStore, input: { projectId: string; cardId: string }): string | null {
  const card = store.card(input.cardId);
  if (card.projectId !== input.projectId) throw new Error('Die Karte gehört nicht zum gewählten Projekt.');
  const record = store.cardWorktree(card.id);
  if (!record) return null;
  if (record.projectId !== input.projectId) throw new Error('Der gespeicherte Worktree gehört zu einem anderen Projekt.');
  const project = store.project(input.projectId);
  const sourceRoot = gitRoot(project.path);
  const expectedPath = join(store.worktreeBase, input.projectId, card.id);
  verifyExisting(record, sourceRoot, expectedPath);
  return realpathSync(record.path);
}

/** A fresh, read-only inventory for future cleanup. Never deletes user files or Git refs. */
export function previewCardWorktreeCleanup(store: StudioStore, cardId: string): WorktreeCleanupPreview | null {
  const card = store.card(cardId);
  const record = store.cardWorktree(cardId);
  if (!record) return null;
  if (record.projectId !== card.projectId) throw new Error('Der gespeicherte Worktree gehört zu einem anderen Projekt.');
  const review = reviewCardWorktree(store, cardId);
  if (!review) return null;
  const ignoredFilesPresent = git(record.path, ['-c', 'core.fsmonitor=false', 'ls-files', '--others', '--ignored', '--exclude-standard', '-z']) !== '';
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', review.sourceHead, review.targetHead], {
    cwd: review.targetPath, timeout: 30_000, maxBuffer: 256 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (ancestor.error || (ancestor.status !== 0 && ancestor.status !== 1)) throw new Error('Git konnte die Übernahme des Worktree-Commits nicht belegen.');
  const mergedIntoTarget = ancestor.status === 0;
  const activeSession = Boolean(store.activeSessionForProject(card.projectId));
  const blockers: string[] = [];
  const base = realpathSync(store.worktreeBase);
  const checkout = realpathSync(record.path);
  if (lstatSync(store.worktreeBase).isSymbolicLink() || !within(base, checkout) || within(realpathSync(review.targetPath), checkout)
    || lstatSync(join(store.worktreeBase, record.projectId)).isSymbolicLink()) blockers.push('Der Checkout liegt nicht sicher im vorgesehenen App-Datenordner.');
  if (!review.targetBranch) blockers.push('Der Ziel-Checkout hat keinen aktiven Branch.');
  // A normal porcelain status omits ignored files, so both checks are required.
  if (review.sourceStatus.length) blockers.push('Der Worktree enthält nicht committete oder unversionierte Dateien.');
  if (ignoredFilesPresent) blockers.push('Der Worktree enthält ignorierte Dateien.');
  if (review.targetStatus.length) blockers.push('Der Ziel-Checkout enthält nicht committete oder unversionierte Dateien.');
  if (!mergedIntoTarget) blockers.push('Der Worktree-Commit ist im Ziel-Checkout nicht enthalten.');
  if (activeSession) blockers.push('In diesem Projekt läuft noch ein Agent.');
  return {
    cardId, path: record.path, branch: record.branch, targetPath: review.targetPath, targetBranch: review.targetBranch,
    sourceHead: review.sourceHead, targetHead: review.targetHead, sourceClean: review.sourceStatus.length === 0,
    targetClean: review.targetStatus.length === 0, ignoredFilesPresent, mergedIntoTarget, activeSession,
    blockers, checkedAt: new Date().toISOString(),
  };
}

/** The only automatic merge is a reviewed fast-forward. No reset, force, delete or conflict resolution. */
export function mergeCardWorktree(store: StudioStore, input: { cardId: string; previewToken: string; confirm: boolean }): WorktreeReview {
  if (input.confirm !== true) throw new Error('Der Merge braucht eine ausdrückliche Bestätigung.');
  if (typeof input.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewToken)) throw new Error('Ungültige Merge-Vorschau.');
  const review = reviewCardWorktree(store, input.cardId);
  if (!review) throw new Error('Für diese Karte ist kein Worktree angelegt.');
  if (review.previewToken !== input.previewToken) throw new Error('Branches haben sich seit der Vorschau geändert. Bitte erneut prüfen.');
  if (!review.canFastForward) throw new Error(`Fast-Forward nicht möglich: ${review.blockers.join(' ')}`);
  // An empty temporary hooks directory prevents repository hooks from running
  // during this app-initiated merge. It is removed only if still empty.
  const emptyHooks = mkdtempSync(join(tmpdir(), 'jarvis-studio-empty-hooks-'));
  try {
    git(review.targetPath, ['-c', `core.hooksPath=${emptyHooks}`, '-c', 'core.fsmonitor=false', 'merge', '--ff-only', review.sourceHead], 120_000);
  } finally {
    try { rmdirSync(emptyHooks); } catch { /* No user worktree data is touched. */ }
  }
  const after = reviewCardWorktree(store, input.cardId);
  if (!after || after.targetHead !== review.sourceHead) throw new Error('Git meldete einen Merge, aber der Ziel-Commit weicht ab. Bitte den Checkout prüfen.');
  return after;
}
