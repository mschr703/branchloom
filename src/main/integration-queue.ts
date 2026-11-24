import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { IntegrationItem, IntegrationState } from '../shared/integration-queue';
import { mergeCardWorktree, reviewCardWorktree, worktreeRepositoryKey } from './git-worktree';
import type { StudioStore } from './store';

interface Row {
  id: number; project_id: string; card_id: string; repository_key: string; target_branch: string;
  source_head: string; target_head: string; card_fingerprint: string; preview_token: string | null;
  state: IntegrationState; reason: string | null; created_at: string; updated_at: string; integrated_head: string | null;
  owner_pid: number | null;
}

const item = (row: Row): IntegrationItem => ({ id: row.id, projectId: row.project_id, cardId: row.card_id,
  targetBranch: row.target_branch, sourceHead: row.source_head, targetHead: row.target_head,
  cardFingerprint: row.card_fingerprint, state: row.state, reason: row.reason, createdAt: row.created_at,
  updatedAt: row.updated_at, integratedHead: row.integrated_head });
const stamp = () => new Date().toISOString();
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function cardFingerprint(store: StudioStore, cardId: string): string {
  const revision = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(cardId) as { content_revision: number };
  return fingerprint([revision.content_revision, store.card(cardId)]);
}

function latestSuccessfulRun(store: StudioStore, cardId: string, worktreePath: string): boolean {
  const last = store.db.prepare('SELECT state, exit_code, worktree_path FROM sessions WHERE card_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1')
    .get(cardId) as { state: string; exit_code: number | null; worktree_path: string | null } | undefined;
  return Boolean(last?.state === 'exited' && last.exit_code === 0 && last.worktree_path === worktreePath);
}

function qaFailure(store: StudioStore, cardId: string): string | null {
  const latest = store.db.prepare('SELECT status FROM card_qa_reports WHERE card_id = ? ORDER BY rowid DESC LIMIT 1')
    .get(cardId) as { status: string } | undefined;
  return latest && latest.status !== 'passed' ? 'The latest saved browser QA report failed. Review it before integration.' : null;
}

export function installIntegrationQueue(store: StudioStore): void {
  store.db.exec(`CREATE TABLE IF NOT EXISTS integration_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
    repository_key TEXT NOT NULL, target_branch TEXT NOT NULL,
    source_head TEXT NOT NULL, target_head TEXT NOT NULL, card_fingerprint TEXT NOT NULL,
    preview_token TEXT, state TEXT NOT NULL CHECK (state IN ('queued','ready','blocked','integrating','integrated')),
    reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, integrated_head TEXT,
    owner_pid INTEGER);
    CREATE INDEX IF NOT EXISTS idx_integration_order ON integration_items(repository_key, target_branch, state, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_target_lock ON integration_items(repository_key, target_branch) WHERE state = 'integrating';`);
  const columns = store.db.prepare('PRAGMA table_info(integration_items)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'owner_pid'))
    store.db.exec('ALTER TABLE integration_items ADD COLUMN owner_pid INTEGER');
}

function rowForCard(store: StudioStore, cardId: string): Row | undefined {
  return store.db.prepare('SELECT * FROM integration_items WHERE card_id = ?').get(cardId) as Row | undefined;
}

function commitIsAncestor(path: string, ancestor: string, descendant: string): boolean {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd: path, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error('Git ancestry could not be verified.');
  return result.status === 0;
}

function gitRead(path: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: path, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.status !== 0) throw new Error('Git target could not be verified.');
  return result.stdout.trim();
}

function ownerIsAlive(pid: number | null): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function update(store: StudioStore, id: number, state: IntegrationState, reason: string | null, integratedHead: string | null = null): IntegrationItem {
  store.db.prepare('UPDATE integration_items SET state = ?, reason = ?, updated_at = ?, integrated_head = ?, owner_pid = NULL WHERE id = ?')
    .run(state, reason, stamp(), integratedHead, id);
  return item(store.db.prepare('SELECT * FROM integration_items WHERE id = ?').get(id) as Row);
}

/** A crash after Git succeeds cannot cause the same commit to be merged again. Unknown outcomes stay blocked. */
export function reconcileIntegration(store: StudioStore, cardId: string): IntegrationItem | null {
  const row = rowForCard(store, cardId);
  if (!row) { store.card(cardId); return null; }
  if (row.state !== 'integrating') return item(row);
  // A second app process may read the queue while the original synchronous Git
  // command is still running. Only an absent owner is safe to reconcile.
  if (ownerIsAlive(row.owner_pid)) return item(row);
  try {
    const targetPath = store.project(row.project_id).path;
    if (worktreeRepositoryKey(targetPath) !== row.repository_key) return item(row);
    // The card worktree may have been removed after Git finished. The stored
    // target branch, rather than its current checkout, is the recovery source.
    const targetHead = gitRead(targetPath, ['rev-parse', '--verify', `refs/heads/${row.target_branch}`]);
    if (commitIsAncestor(targetPath, row.source_head, targetHead)) return update(store, row.id, 'integrated', null, targetHead);
    return update(store, row.id, 'blocked', 'App was interrupted during integration. Git does not show the source commit in the target; review before retry.');
  } catch { return item(row); }
}

export function integrationQueue(store: StudioStore, projectId: string): IntegrationItem[] {
  store.project(projectId);
  // A target slot may have been reserved by another project using the same repository.
  const pending = store.db.prepare("SELECT card_id FROM integration_items WHERE state = 'integrating'").all() as Array<{ card_id: string }>;
  for (const row of pending) reconcileIntegration(store, row.card_id);
  const rows = store.db.prepare('SELECT card_id FROM integration_items WHERE project_id = ? ORDER BY id').all(projectId) as Array<{ card_id: string }>;
  return rows.map((row) => reconcileIntegration(store, row.card_id)!).filter(Boolean);
}

/** Explicitly queue a successfully finished card with a saved, clean Git worktree. */
export function enqueueIntegration(store: StudioStore, cardId: string): IntegrationItem {
  const card = store.card(cardId);
  if (card.archivedAt) throw new Error('Archived cards cannot be queued for integration.');
  const review = reviewCardWorktree(store, cardId);
  if (!review || !review.targetBranch || review.ahead < 1) throw new Error('A saved worktree with new commits and an active target branch is required.');
  if (!latestSuccessfulRun(store, cardId, review.path)) throw new Error('The latest card run must finish successfully in its saved worktree.');
  const existing = rowForCard(store, cardId);
  if (existing && existing.state !== 'integrated') throw new Error('This card is already in the integration queue.');
  const key = worktreeRepositoryKey(review.targetPath);
  const createdAt = stamp();
  return store.db.transaction(() => {
    if (existing) store.db.prepare('DELETE FROM integration_items WHERE id = ?').run(existing.id);
    store.db.prepare(`INSERT INTO integration_items
      (project_id, card_id, repository_key, target_branch, source_head, target_head, card_fingerprint, preview_token, state, reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'queued', NULL, ?, ?)`).run(card.projectId, cardId, key, review.targetBranch,
      review.sourceHead, review.targetHead, cardFingerprint(store, cardId), createdAt, createdAt);
    return item(rowForCard(store, cardId)!);
  })();
}

/** Refresh the actual Git base and card revision. Divergence remains visible and untouched. */
export function prepareIntegration(store: StudioStore, cardId: string): IntegrationItem {
  const row = rowForCard(store, cardId);
  if (!row) throw new Error('Card is not in the integration queue.');
  if (row.state === 'integrated' || row.state === 'integrating') throw new Error('Integration is already completed or being reconciled.');
  const review = reviewCardWorktree(store, cardId);
  if (!review || !review.targetBranch || worktreeRepositoryKey(review.targetPath) !== row.repository_key || review.targetBranch !== row.target_branch)
    return update(store, row.id, 'blocked', 'The target repository or branch changed. The queued target must be reviewed.');
  const card = store.card(cardId);
  const reason = card.archivedAt ? 'The card is archived.'
    : !latestSuccessfulRun(store, cardId, review.path) ? 'The latest card run is no longer a successful worktree run.'
      : qaFailure(store, cardId) ?? review.blockers.join(' ');
  store.db.prepare(`UPDATE integration_items SET source_head = ?, target_head = ?, card_fingerprint = ?, preview_token = ?, state = ?, reason = ?, updated_at = ? WHERE id = ?`)
    .run(review.sourceHead, review.targetHead, cardFingerprint(store, cardId), review.canFastForward && !reason ? review.previewToken : null,
      review.canFastForward && !reason ? 'ready' : 'blocked', reason || null, stamp(), row.id);
  return item(rowForCard(store, cardId)!);
}

/** Single target-branch slot, fresh checks, then existing reviewed ff-only path. Manual approval is required. */
export function approveIntegration(store: StudioStore, input: { cardId: string; confirm: boolean }): IntegrationItem {
  if (input.confirm !== true) throw new Error('Explicit integration approval is required.');
  const row = rowForCard(store, input.cardId);
  if (!row || row.state !== 'ready' || !row.preview_token) throw new Error('Prepare this integration again before approval.');
  const precedingPending = store.db.prepare(`SELECT card_id FROM integration_items WHERE repository_key = ? AND target_branch = ?
    AND id < ? AND state = 'integrating'`).all(row.repository_key, row.target_branch, row.id) as Array<{ card_id: string }>;
  for (const pending of precedingPending) reconcileIntegration(store, pending.card_id);
  const preceding = store.db.prepare(`SELECT id FROM integration_items WHERE repository_key = ? AND target_branch = ?
    AND id < ? AND state IN ('queued','ready','integrating') ORDER BY id LIMIT 1`).get(row.repository_key, row.target_branch, row.id);
  if (preceding) throw new Error('An earlier card is waiting for this target branch.');
  if (cardFingerprint(store, input.cardId) !== row.card_fingerprint) throw new Error('Card changed since preparation. Prepare again.');
  const review = reviewCardWorktree(store, input.cardId);
  if (!review || !review.canFastForward || review.previewToken !== row.preview_token || review.targetHead !== row.target_head
    || review.sourceHead !== row.source_head || review.targetBranch !== row.target_branch || worktreeRepositoryKey(review.targetPath) !== row.repository_key)
    throw new Error('Git base or source changed since preparation. Prepare and verify again.');
  if (!latestSuccessfulRun(store, input.cardId, review.path) || qaFailure(store, input.cardId))
    throw new Error('Card run or browser QA changed since preparation. Prepare again.');
  store.db.transaction(() => {
    const current = rowForCard(store, input.cardId);
    if (!current || current.state !== 'ready') throw new Error('Integration state changed.');
    const earlier = store.db.prepare(`SELECT id FROM integration_items WHERE repository_key = ? AND target_branch = ?
      AND id < ? AND state IN ('queued','ready','integrating') ORDER BY id LIMIT 1`)
      .get(row.repository_key, row.target_branch, row.id);
    if (earlier) throw new Error('An earlier card is waiting for this target branch.');
    if (cardFingerprint(store, input.cardId) !== row.card_fingerprint) throw new Error('Card changed since preparation. Prepare again.');
    if (!latestSuccessfulRun(store, input.cardId, review.path) || qaFailure(store, input.cardId))
      throw new Error('Card run or browser QA changed since preparation. Prepare again.');
    store.db.prepare("UPDATE integration_items SET state = 'integrating', reason = NULL, updated_at = ?, integrated_head = NULL, owner_pid = ? WHERE id = ?")
      .run(stamp(), process.pid, row.id);
  }).immediate();
  try {
    mergeCardWorktree(store, { cardId: input.cardId, previewToken: row.preview_token, confirm: true });
    return update(store, row.id, 'integrated', null, row.source_head);
  } catch (error) {
    // The Git command may have succeeded before a process error. Reconcile its actual target state.
    store.db.prepare('UPDATE integration_items SET owner_pid = NULL WHERE id = ? AND owner_pid = ?')
      .run(row.id, process.pid);
    const recovered = reconcileIntegration(store, input.cardId);
    if (recovered?.state === 'integrated') return recovered;
    if (recovered?.state === 'integrating') return recovered;
    throw error;
  }
}
