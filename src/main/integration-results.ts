import { spawnSync } from 'node:child_process';
import type { IntegrationResultEntry, IntegrationResultFolder } from '../shared/integration-results';
import { worktreeRepositoryKey } from './git-worktree';
import { integrationQueue } from './integration-queue';
import type { StudioStore } from './store';

const MAX_ENTRIES = 200;

interface SnapshotRow {
  source_head: string; target_head: string; card_fingerprint: string;
}
interface ReviewRow extends SnapshotRow { reviewed_at: string }
interface TestRow extends SnapshotRow {
  script_name: string; state: string; exit_code: number | null; ended_at: string | null;
}

type InternalEntry = IntegrationResultEntry & { cardFingerprint: string };

function matchesSavedSnapshot(row: SnapshotRow, entry: InternalEntry): boolean {
  return row.source_head === entry.sourceHead && row.target_head === entry.targetHead
    && row.card_fingerprint === entry.cardFingerprint;
}

function gitRead(path: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd: path, encoding: 'utf8', windowsHide: true,
    timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return result.error || result.status !== 0 ? null : result.stdout.trim();
}

function currentGitPresence(path: string, currentRepositoryKey: string | null, repositoryKey: string,
  branch: string, sourceHead: string, targetHeads: Map<string, string | null>):
  Pick<IntegrationResultEntry, 'gitPresence' | 'currentTargetHead'> {
  try {
    if (!/^[a-f0-9]{40,64}$/u.test(sourceHead) || currentRepositoryKey !== repositoryKey)
      return { gitPresence: 'unverified', currentTargetHead: null };
    if (!targetHeads.has(branch))
      targetHeads.set(branch, gitRead(path, ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branch}`]));
    const currentTargetHead = targetHeads.get(branch);
    if (!currentTargetHead || !/^[a-f0-9]{40,64}$/u.test(currentTargetHead))
      return { gitPresence: 'unverified', currentTargetHead: null };
    const result = spawnSync('git', ['merge-base', '--is-ancestor', sourceHead, currentTargetHead], {
      cwd: path, encoding: 'utf8', windowsHide: true, timeout: 10_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { gitPresence: result.error || (result.status !== 0 && result.status !== 1) ? 'unverified'
      : result.status === 0 ? 'present' : 'missing', currentTargetHead };
  } catch { return { gitPresence: 'unverified', currentTargetHead: null }; }
}

/** No Git writes: bounded summary built from durable queue, review and test receipts. */
export function integrationResultFolder(store: StudioStore, projectId: string): IntegrationResultFolder {
  const project = store.project(projectId);
  const all = integrationQueue(store, projectId);
  const recent = all.slice(-MAX_ENTRIES);
  let currentRepositoryKey: string | null = null;
  try { currentRepositoryKey = worktreeRepositoryKey(project.path); } catch { /* A missing project remains visibly unverified. */ }
  const targetHeads = new Map<string, string | null>();
  const entries: IntegrationResultEntry[] = recent.map((item) => {
    const title = store.card(item.cardId).title;
    const entry: InternalEntry = {
      cardId: item.cardId, title, state: item.state, reason: item.reason,
      sourceHead: item.sourceHead, targetHead: item.targetHead, targetBranch: item.targetBranch,
      integratedHead: item.integratedHead, approvalMode: item.approvalMode, updatedAt: item.updatedAt,
      cardFingerprint: item.cardFingerprint, review: null, test: null, gitPresence: null, currentTargetHead: null,
    };
    const review = store.db.prepare('SELECT source_head, target_head, card_fingerprint, reviewed_at FROM integration_reviews WHERE item_id = ?')
      .get(item.id) as ReviewRow | undefined;
    if (review) entry.review = { reviewedAt: review.reviewed_at, matchesSavedSnapshot: matchesSavedSnapshot(review, entry) };
    const test = store.db.prepare(`SELECT source_head, target_head, card_fingerprint, script_name, state, exit_code, ended_at
      FROM integration_test_runs WHERE item_id = ? ORDER BY id DESC LIMIT 1`).get(item.id) as TestRow | undefined;
    if (test) entry.test = { scriptName: test.script_name, state: test.state, exitCode: test.exit_code,
      endedAt: test.ended_at, matchesSavedSnapshot: matchesSavedSnapshot(test, entry) };
    if (entry.state === 'integrated') {
      const row = store.db.prepare('SELECT repository_key FROM integration_items WHERE id = ?')
        .get(item.id) as { repository_key: string };
      Object.assign(entry, currentGitPresence(project.path, currentRepositoryKey, row.repository_key,
        entry.targetBranch, entry.sourceHead, targetHeads));
    }
    const { cardFingerprint: _cardFingerprint, ...publicEntry } = entry;
    return publicEntry;
  });
  return { projectId, projectName: project.name, generatedAt: new Date().toISOString(),
    entries, omittedCount: all.length - recent.length };
}
