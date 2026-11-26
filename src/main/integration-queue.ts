import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { IntegrationItem, IntegrationPolicy, IntegrationState } from '../shared/integration-queue';
import { assertProjectCanStart } from './project-pause';
import { mergeCardWorktree, reviewCardWorktree, worktreeRepositoryKey } from './git-worktree';
import { divergentIntegration, divergentPreviewToken, installDivergentIntegration, mergeDivergentIntegration } from './divergent-integration';
import type { StudioStore } from './store';

interface Row {
  id: number; project_id: string; card_id: string; repository_key: string; target_branch: string;
  source_head: string; target_head: string; card_fingerprint: string; preview_token: string | null;
  state: IntegrationState; reason: string | null; created_at: string; updated_at: string; integrated_head: string | null;
  owner_pid: number | null; approval_mode: 'manual' | 'automatic' | null;
}

const item = (row: Row): IntegrationItem => ({ id: row.id, projectId: row.project_id, cardId: row.card_id,
  targetBranch: row.target_branch, sourceHead: row.source_head, targetHead: row.target_head,
  cardFingerprint: row.card_fingerprint, state: row.state, reason: row.reason, createdAt: row.created_at,
  updatedAt: row.updated_at, integratedHead: row.integrated_head, approvalMode: row.approval_mode });
const stamp = () => new Date().toISOString();
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function cardFingerprint(store: StudioStore, cardId: string): string {
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
    owner_pid INTEGER, approval_mode TEXT CHECK (approval_mode IN ('manual','automatic')));
    CREATE INDEX IF NOT EXISTS idx_integration_order ON integration_items(repository_key, target_branch, state, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_target_lock ON integration_items(repository_key, target_branch) WHERE state = 'integrating';
    CREATE TABLE IF NOT EXISTS integration_policies (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('manual','automatic')),
      updated_at TEXT NOT NULL);`);
  const columns = store.db.prepare('PRAGMA table_info(integration_items)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'owner_pid'))
    store.db.exec('ALTER TABLE integration_items ADD COLUMN owner_pid INTEGER');
  if (!columns.some((column) => column.name === 'approval_mode'))
    store.db.exec("ALTER TABLE integration_items ADD COLUMN approval_mode TEXT CHECK (approval_mode IN ('manual','automatic'))");
  installDivergentIntegration(store);
}

export function integrationPolicy(store: StudioStore, projectId: string): IntegrationPolicy {
  store.project(projectId);
  const row = store.db.prepare('SELECT mode, updated_at FROM integration_policies WHERE project_id = ?')
    .get(projectId) as { mode: IntegrationPolicy['mode']; updated_at: string } | undefined;
  return { projectId, mode: row?.mode ?? 'manual', updatedAt: row?.updated_at ?? null };
}

/** Automatic Git writes require an explicit project decision and a configured test script. */
export function setIntegrationPolicy(store: StudioStore, input: { projectId: string; mode: IntegrationPolicy['mode']; confirm: boolean }): IntegrationPolicy {
  if (!input || typeof input.projectId !== 'string' || !['manual', 'automatic'].includes(input.mode))
    throw new Error('Invalid integration policy.');
  store.project(input.projectId);
  if (input.mode === 'automatic' && integrationPolicy(store, input.projectId).mode !== 'automatic'
    && store.projectQueue(input.projectId).state === 'running')
    throw new Error('Pause the project queue before enabling automatic integration.');
  if (input.mode === 'automatic') {
    if (input.confirm !== true) throw new Error('Explicit automatic integration consent is required.');
    const script = store.db.prepare('SELECT script_name FROM integration_test_config WHERE project_id = ?')
      .get(input.projectId) as { script_name: string } | undefined;
    if (!script) throw new Error('Configure an npm integration test before enabling automatic integration.');
  }
  store.db.prepare(`INSERT INTO integration_policies (project_id, mode, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`)
    .run(input.projectId, input.mode, stamp());
  return integrationPolicy(store, input.projectId);
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
  const attempt = divergentIntegration(store, cardId);
  const reason = card.archivedAt ? 'The card is archived.'
    : !latestSuccessfulRun(store, cardId, review.path) ? 'The latest card run is no longer a successful worktree run.'
      : qaFailure(store, cardId) ?? (attempt ? attempt.reason : review.blockers.join(' '));
  const ready = attempt ? attempt.state === 'ready' && !reason : review.canFastForward && !reason;
  const sourceHead = attempt?.state === 'ready' && attempt.resultHead ? attempt.resultHead : review.sourceHead;
  const previewToken = ready && review.targetBranch ? (attempt
    ? divergentPreviewToken(cardId, sourceHead, review.targetBranch, review.targetHead) : review.previewToken) : null;
  store.db.prepare(`UPDATE integration_items SET source_head = ?, target_head = ?, card_fingerprint = ?, preview_token = ?, state = ?, reason = ?, updated_at = ? WHERE id = ?`)
    .run(sourceHead, review.targetHead, cardFingerprint(store, cardId), previewToken,
      ready ? 'ready' : 'blocked', reason || null, stamp(), row.id);
  return item(rowForCard(store, cardId)!);
}

/** Immutable Git/card snapshot that a separate check or review may attest to. */
export function currentPreparedIntegration(store: StudioStore, cardId: string): { item: IntegrationItem; worktreePath: string; repositoryKey: string; previewToken: string } {
  const row = rowForCard(store, cardId);
  if (!row || row.state !== 'ready' || !row.preview_token) throw new Error('Prepare this integration again before checking it.');
  if (cardFingerprint(store, cardId) !== row.card_fingerprint) throw new Error('Card changed since preparation. Prepare again.');
  const review = reviewCardWorktree(store, cardId);
  const attempt = divergentIntegration(store, cardId);
  const valid = attempt ? attempt.state === 'ready' && attempt.resultHead === row.source_head
    && attempt.originalSourceHead === review?.sourceHead && review?.targetHead === row.target_head
    && review?.targetBranch === row.target_branch
    && divergentPreviewToken(cardId, row.source_head, row.target_branch, row.target_head) === row.preview_token
    : review?.canFastForward && review.previewToken === row.preview_token && review.sourceHead === row.source_head
      && review.targetHead === row.target_head && review.targetBranch === row.target_branch;
  if (!review || !valid || worktreeRepositoryKey(review.targetPath) !== row.repository_key)
    throw new Error('Git base or source changed since preparation. Prepare and verify again.');
  if (!latestSuccessfulRun(store, cardId, review.path) || qaFailure(store, cardId))
    throw new Error('Card run or browser QA changed since preparation. Prepare again.');
  return { item: item(row), worktreePath: attempt?.path ?? review.path, repositoryKey: row.repository_key, previewToken: row.preview_token };
}

function requireBoundEvidence(store: StudioStore, row: Row): void {
  const review = store.db.prepare('SELECT source_head, target_head, card_fingerprint FROM integration_reviews WHERE item_id = ?')
    .get(row.id) as { source_head: string; target_head: string; card_fingerprint: string } | undefined;
  if (!review || review.source_head !== row.source_head || review.target_head !== row.target_head
    || review.card_fingerprint !== row.card_fingerprint) throw new Error('Review this exact prepared Git diff before integration.');
  const test = store.db.prepare('SELECT state, source_head, target_head, card_fingerprint, script_name FROM integration_test_runs WHERE item_id = ? ORDER BY id DESC LIMIT 1')
    .get(row.id) as { state: string; source_head: string; target_head: string; card_fingerprint: string; script_name: string } | undefined;
  if (test?.state === 'running') throw new Error('An integration test is still running for this card.');
  const config = store.db.prepare('SELECT script_name FROM integration_test_config WHERE project_id = ?')
    .get(row.project_id) as { script_name: string } | undefined;
  if (!config) {
    const divergent = store.db.prepare('SELECT item_id FROM divergent_integration_attempts WHERE item_id = ?').get(row.id);
    if (divergent) throw new Error('Configure and run an npm integration test for this divergent result before merging.');
    return;
  }
  if (!test || test.state !== 'passed' || test.source_head !== row.source_head || test.target_head !== row.target_head
    || test.card_fingerprint !== row.card_fingerprint || test.script_name !== config.script_name)
    throw new Error('Run the configured test script successfully for this exact source and target before integration.');
}

function requireAutomaticEvidence(store: StudioStore, row: Row): void {
  if (integrationPolicy(store, row.project_id).mode !== 'automatic')
    throw new Error('Automatic integration was disabled before the Git write.');
  const manualRevision = store.db.prepare('SELECT id FROM manual_file_revisions WHERE card_id = ? AND applied_at IS NULL LIMIT 1')
    .get(row.card_id);
  if (manualRevision) throw new Error('An unresolved manual file revision belongs to this card. Review it before automatic integration.');
  const config = store.db.prepare('SELECT script_name FROM integration_test_config WHERE project_id = ?')
    .get(row.project_id) as { script_name: string } | undefined;
  if (!config) throw new Error('Automatic integration requires a configured npm test.');
  requireBoundEvidence(store, row);
  const test = store.db.prepare(`SELECT state, exit_code, ended_at, script_name, source_head, target_head, card_fingerprint
    FROM integration_test_runs WHERE item_id = ? ORDER BY id DESC LIMIT 1`).get(row.id) as {
      state: string; exit_code: number | null; ended_at: string | null; script_name: string;
      source_head: string; target_head: string; card_fingerprint: string;
    } | undefined;
  if (!test || test.state !== 'passed' || test.exit_code !== 0 || !test.ended_at || test.script_name !== config.script_name
    || test.source_head !== row.source_head || test.target_head !== row.target_head || test.card_fingerprint !== row.card_fingerprint)
    throw new Error('Automatic integration needs a current, passing npm test for this exact Git and card revision.');
}

/** Shared durable target slot and ff-only checks for both deliberate policies. */
function integratePrepared(store: StudioStore, input: { cardId: string; mode: 'manual' | 'automatic' }): IntegrationItem {
  const row = rowForCard(store, input.cardId);
  if (row) assertProjectCanStart(store, row.project_id);
  if (!row || row.state !== 'ready' || !row.preview_token) throw new Error('Prepare this integration again before approval.');
  if (input.mode === 'automatic') requireAutomaticEvidence(store, row);
  const previewToken = row.preview_token;
  const precedingPending = store.db.prepare(`SELECT card_id FROM integration_items WHERE repository_key = ? AND target_branch = ?
    AND id < ? AND state = 'integrating'`).all(row.repository_key, row.target_branch, row.id) as Array<{ card_id: string }>;
  for (const pending of precedingPending) reconcileIntegration(store, pending.card_id);
  const preceding = store.db.prepare(`SELECT id FROM integration_items WHERE repository_key = ? AND target_branch = ?
    AND id < ? AND state IN ('queued','ready','blocked','integrating') ORDER BY id LIMIT 1`).get(row.repository_key, row.target_branch, row.id);
  if (preceding) throw new Error('An earlier card is waiting for this target branch.');
  if (cardFingerprint(store, input.cardId) !== row.card_fingerprint) throw new Error('Card changed since preparation. Prepare again.');
  const review = reviewCardWorktree(store, input.cardId);
  const prepared = currentPreparedIntegration(store, input.cardId);
  if (!review || prepared.previewToken !== row.preview_token || prepared.item.sourceHead !== row.source_head)
    throw new Error('Git base or source changed since preparation. Prepare and verify again.');
  const attempt = divergentIntegration(store, input.cardId);
  if (!latestSuccessfulRun(store, input.cardId, review.path) || qaFailure(store, input.cardId))
    throw new Error('Card run or browser QA changed since preparation. Prepare again.');
  requireBoundEvidence(store, row);
  store.db.transaction(() => {
    assertProjectCanStart(store, row.project_id);
    const current = rowForCard(store, input.cardId);
    if (!current || current.state !== 'ready') throw new Error('Integration state changed.');
    const earlier = store.db.prepare(`SELECT id FROM integration_items WHERE repository_key = ? AND target_branch = ?
      AND id < ? AND state IN ('queued','ready','blocked','integrating') ORDER BY id LIMIT 1`)
      .get(row.repository_key, row.target_branch, row.id);
    if (earlier) throw new Error('An earlier card is waiting for this target branch.');
    if (cardFingerprint(store, input.cardId) !== row.card_fingerprint) throw new Error('Card changed since preparation. Prepare again.');
    if (!latestSuccessfulRun(store, input.cardId, review.path) || qaFailure(store, input.cardId))
      throw new Error('Card run or browser QA changed since preparation. Prepare again.');
    requireBoundEvidence(store, current);
    if (input.mode === 'automatic') requireAutomaticEvidence(store, current);
    store.db.prepare("UPDATE integration_items SET state = 'integrating', reason = NULL, updated_at = ?, integrated_head = NULL, owner_pid = ?, approval_mode = ? WHERE id = ?")
      .run(stamp(), process.pid, input.mode, row.id);
  }).immediate();
  try {
    // The durable reservation above survives a crash. This second transaction
    // holds the SQLite write lock across the last evidence check and Git write,
    // so another app process cannot change the card or QA in between.
    return store.db.transaction(() => {
      const current = rowForCard(store, input.cardId);
      if (!current || current.state !== 'integrating' || current.owner_pid !== process.pid)
        throw new Error('Integration reservation changed.');
      if (cardFingerprint(store, input.cardId) !== current.card_fingerprint
        || !latestSuccessfulRun(store, input.cardId, review.path) || qaFailure(store, input.cardId))
        throw new Error('Card run or browser QA changed during integration.');
      requireBoundEvidence(store, current);
      if (input.mode === 'automatic') requireAutomaticEvidence(store, current);
      if (attempt) mergeDivergentIntegration(store, input.cardId, row.source_head, row.target_head);
      else mergeCardWorktree(store, { cardId: input.cardId, previewToken, confirm: true });
      return update(store, row.id, 'integrated', null, row.source_head);
    }).immediate();
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

/** The UI's explicit one-card merge remains available regardless of project policy. */
export function approveIntegration(store: StudioStore, input: { cardId: string; confirm: boolean }): IntegrationItem {
  if (input.confirm !== true) throw new Error('Explicit integration approval is required.');
  return integratePrepared(store, { cardId: input.cardId, mode: 'manual' });
}

/** Consider only the oldest unfinished card per repository and target branch. Never prepare, run tests, or resolve conflicts here. */
export function advanceAutomaticIntegrations(store: StudioStore): IntegrationItem[] {
  const pending = store.db.prepare(`SELECT card_id, repository_key, target_branch FROM integration_items
    WHERE state IN ('queued','ready','blocked','integrating') ORDER BY repository_key, target_branch, id`).all() as
    Array<{ card_id: string; repository_key: string; target_branch: string }>;
  const seen = new Set<string>();
  const completed: IntegrationItem[] = [];
  for (const entry of pending) {
    const key = `${entry.repository_key}\0${entry.target_branch}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rowForCard(store, entry.card_id);
    if (!row || row.state !== 'ready' || integrationPolicy(store, row.project_id).mode !== 'automatic') continue;
    try { completed.push(integratePrepared(store, { cardId: row.card_id, mode: 'automatic' })); }
    catch (error) {
      // Leave the prepared snapshot intact; surface why the optional worker is waiting.
      const latest = rowForCard(store, row.card_id);
      if (latest?.state === 'ready') {
        const reason = (error instanceof Error ? error.message : 'Automatic integration needs review.').slice(0, 500);
        if (latest.reason !== reason) store.db.prepare('UPDATE integration_items SET reason = ?, updated_at = ? WHERE id = ?')
          .run(reason, stamp(), latest.id);
      }
    }
  }
  return completed;
}
