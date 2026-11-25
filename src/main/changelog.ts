import { execFile } from 'node:child_process';
import { lstat, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChangelogCommit, ChangelogIntegrationReceipt, ChangelogIssue, ChangelogPeriod, ChangelogQaObservation, ChangelogReviewActivity, ChangelogScope, ChangelogSource, ProjectChangelog } from '../shared/changelog';
import { worktreeRepositoryKey } from './git-worktree';
import type { CardWorktree } from './store';
import type { StudioStore } from './store';

const MAX_VISIBLE = 100;
const MAX_OUTPUT = 512 * 1024;
const GIT_TIMEOUT_MS = 5_000;
const MAX_WORKTREES = 12;
const WORKTREE_BUDGET_MS = 30_000;
const MAX_QA_OBSERVATIONS = 20;
const MAX_REVIEW_CARDS = 10;
const MAX_INTEGRATIONS = 10;

type QaRow = { id: string; card_id: string; card_title: string; ended_at: string; status: ChangelogQaObservation['status']; git_evidence_json: string };
type ReviewRow = { card_id: string; card_title: string; count: number; last_at: string };
type IntegrationRow = {
  card_id: string; card_title: string; updated_at: string; integrated_head: string | null;
  target_branch: string; approval_mode: 'manual' | 'automatic' | null; repository_key: string;
  source_head: string; target_head: string; card_fingerprint: string;
  reviewed_at: string | null; review_source_head: string | null; review_target_head: string | null; review_card_fingerprint: string | null;
  test_script_name: string | null; test_state: string | null; test_exit_code: number | null;
  test_source_head: string | null; test_target_head: string | null; test_card_fingerprint: string | null;
};

function oneLine(value: string): string { return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120); }

function checkoutObservation(value: string): Pick<ChangelogQaObservation, 'checkoutState' | 'checkoutHead'> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | null;
    const state = parsed?.state;
    const checkoutState = state === 'clean' || state === 'dirty' || state === 'changed' || state === 'unavailable' ? state : 'not-recorded';
    const head = parsed?.startHead;
    const checkoutHead = checkoutState === 'clean' && head === parsed?.endHead && typeof head === 'string' && /^[a-f0-9]{40,64}$/i.test(head) ? head : null;
    return { checkoutState: checkoutState === 'clean' && !checkoutHead ? 'unavailable' : checkoutState, checkoutHead };
  } catch { return { checkoutState: 'not-recorded', checkoutHead: null }; }
}

function localEvidence(store: StudioStore, projectId: string, since: string, until: string): Pick<ProjectChangelog, 'qaObservations' | 'qaTotal' | 'reviewActivity' | 'reviewTotal'> {
  const qaFilter = `FROM card_qa_reports q JOIN cards c ON c.id = q.card_id
    WHERE c.project_id = ? AND q.project_id = ? AND q.ended_at >= ? AND q.ended_at <= ? AND q.status IN ('passed','failed','error')`;
  const qaArgs = [projectId, projectId, since, until];
  const qaTotal = (store.db.prepare(`SELECT COUNT(*) AS count ${qaFilter}`).get(...qaArgs) as { count: number }).count;
  const qaRows = store.db.prepare(`SELECT q.id, q.card_id, c.title AS card_title, q.ended_at, q.status, q.git_evidence_json ${qaFilter}
    ORDER BY q.ended_at DESC, q.rowid DESC LIMIT ${MAX_QA_OBSERVATIONS}`).all(...qaArgs) as QaRow[];
  const qaObservations = qaRows.map((row) => ({ id: row.id, cardId: row.card_id, cardTitle: oneLine(row.card_title),
    endedAt: row.ended_at, status: row.status, ...checkoutObservation(row.git_evidence_json) }));

  const reviewFilter = 'FROM review_comments r JOIN cards c ON c.id = r.card_id WHERE c.project_id = ? AND r.created_at >= ? AND r.created_at <= ?';
  const reviewArgs = [projectId, since, until];
  const reviewTotal = (store.db.prepare(`SELECT COUNT(*) AS count ${reviewFilter}`).get(...reviewArgs) as { count: number }).count;
  const reviewRows = store.db.prepare(`SELECT r.card_id, c.title AS card_title, COUNT(*) AS count, MAX(r.created_at) AS last_at ${reviewFilter}
    GROUP BY r.card_id ORDER BY last_at DESC, r.card_id LIMIT ${MAX_REVIEW_CARDS}`).all(...reviewArgs) as ReviewRow[];
  const reviewActivity = reviewRows.map((row) => ({ cardId: row.card_id, cardTitle: oneLine(row.card_title), count: row.count, lastAt: row.last_at }));
  return { qaObservations, qaTotal, reviewActivity, reviewTotal };
}

function integrationEvidence(store: StudioStore, projectId: string, since: string, until: string):
  { rows: IntegrationRow[]; receipts: ChangelogIntegrationReceipt[]; total: number } {
  const from = 'FROM integration_items i JOIN cards c ON c.id = i.card_id';
  const where = "WHERE i.project_id = ? AND c.project_id = ? AND i.state = 'integrated' AND i.updated_at >= ? AND i.updated_at <= ?";
  const args = [projectId, projectId, since, until];
  const total = (store.db.prepare(`SELECT COUNT(*) AS count ${from} ${where}`).get(...args) as { count: number }).count;
  const rows = store.db.prepare(`SELECT i.card_id, c.title AS card_title, i.updated_at, i.integrated_head,
    i.target_branch, i.approval_mode, i.repository_key, i.source_head, i.target_head, i.card_fingerprint,
    r.reviewed_at, r.source_head AS review_source_head, r.target_head AS review_target_head,
    r.card_fingerprint AS review_card_fingerprint,
    t.script_name AS test_script_name, t.state AS test_state, t.exit_code AS test_exit_code,
    t.source_head AS test_source_head, t.target_head AS test_target_head, t.card_fingerprint AS test_card_fingerprint
    ${from}
    LEFT JOIN integration_reviews r ON r.item_id = i.id
    LEFT JOIN integration_test_runs t ON t.id = (SELECT id FROM integration_test_runs WHERE item_id = i.id ORDER BY id DESC LIMIT 1)
    ${where}
    ORDER BY i.updated_at DESC, i.id DESC LIMIT ${MAX_INTEGRATIONS}`).all(...args) as IntegrationRow[];
  const matches = (row: IntegrationRow, prefix: 'review' | 'test') =>
    row[`${prefix}_source_head`] === row.source_head && row[`${prefix}_target_head`] === row.target_head
    && row[`${prefix}_card_fingerprint`] === row.card_fingerprint;
  const receipts = rows.map((row): ChangelogIntegrationReceipt => ({
    cardId: row.card_id, cardTitle: oneLine(row.card_title), integratedAt: row.updated_at,
    integratedHead: row.integrated_head, targetBranch: oneLine(row.target_branch), approvalMode: row.approval_mode,
    headPresence: 'unverified', review: row.reviewed_at ? { reviewedAt: row.reviewed_at, matchesSnapshot: matches(row, 'review') } : null,
    test: row.test_script_name ? { scriptName: oneLine(row.test_script_name), state: row.test_state ?? 'unknown',
      exitCode: row.test_exit_code, matchesSnapshot: matches(row, 'test') } : null,
  }));
  return { rows, receipts, total };
}

function git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<{ stdout: string; failed: boolean; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...args], {
      cwd, encoding: 'utf8', timeout, maxBuffer: MAX_OUTPUT, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout) => {
      if (error?.killed || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') { reject(new Error('Git-Changelog überschritt das Zeit- oder Größenlimit.')); return; }
      if (error && error.code === 'ENOENT') { reject(new Error('Git ist nicht installiert oder nicht erreichbar.')); return; }
      if (stdout.includes('\uFFFD')) { reject(new Error('Git-Historie enthält unlesbare Zeichen.')); return; }
      resolve({ stdout, failed: Boolean(error), exitCode: error ? typeof error.code === 'number' ? error.code : null : 0 });
    });
  });
}

async function verifyIntegrationPresence(path: string, head: string, evidence: ReturnType<typeof integrationEvidence>): Promise<ChangelogIntegrationReceipt[]> {
  let currentRepositoryKey: string | null = null;
  try { currentRepositoryKey = worktreeRepositoryKey(path); } catch { /* A changed repository remains unverified. */ }
  return Promise.all(evidence.rows.map(async (row, index) => {
    const receipt = evidence.receipts[index]!;
    if (!currentRepositoryKey || row.repository_key !== currentRepositoryKey || !row.integrated_head || !/^[a-f0-9]{40,64}$/i.test(row.integrated_head))
      return receipt;
    try {
      const result = await git(path, ['merge-base', '--is-ancestor', row.integrated_head, head]);
      return { ...receipt, headPresence: result.exitCode === 0 ? 'present' as const : result.exitCode === 1 ? 'missing' as const : 'unverified' as const };
    } catch { return receipt; }
  }));
}

function remaining(deadline: number): number {
  const left = deadline - Date.now();
  if (left < 1) throw new Error('Zeitlimit für Karten-Worktrees erreicht.');
  return Math.min(GIT_TIMEOUT_MS, left);
}

async function checkedGit(cwd: string, args: string[], deadline: number): Promise<string> {
  const result = await git(cwd, args, remaining(deadline));
  if (result.failed) throw new Error('Gespeicherter Karten-Worktree konnte nicht mit Git geprüft werden.');
  return result.stdout.trim();
}

async function sameDirectory(left: string, right: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([stat(left, { bigint: true }), stat(right, { bigint: true })]);
    if (a.ino !== 0n && b.ino !== 0n) return a.dev === b.dev && a.ino === b.ino;
    const [first, second] = await Promise.all([realpath(left), realpath(right)]);
    return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
  } catch { return false; }
}

async function verifySavedWorktree(store: StudioStore, record: CardWorktree, projectRoot: string, commonDir: string, deadline: number): Promise<void> {
  if ((await lstat(record.path)).isSymbolicLink()) throw new Error('Gespeicherter Worktree-Pfad ist ein symbolischer Link.');
  const expected = join(store.worktreeBase, record.projectId, record.cardId);
  if (!await sameDirectory(record.path, expected) || !await sameDirectory(record.sourceRoot, projectRoot)) {
    throw new Error('Gespeicherter Worktree gehört nicht mehr zu diesem Projekt.');
  }
  const [root, common, branch] = await Promise.all([
    checkedGit(record.path, ['rev-parse', '--show-toplevel'], deadline),
    checkedGit(record.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'], deadline),
    checkedGit(record.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], deadline),
  ]);
  if (!await sameDirectory(root, record.path) || !await sameDirectory(common, commonDir) || branch !== record.branch) {
    throw new Error('Gespeicherter Worktree hat einen anderen Git-Ursprung oder Branch.');
  }
}

export function parseChangelogLog(output: string): ChangelogCommit[] {
  if (!output) return [];
  if (!output.endsWith('\0\0')) throw new Error('Git-Changelog ist unvollständig.');
  return output.slice(0, -2).split('\0\0').map((record) => {
    const parts = record.split('\0');
    if (parts.length !== 3 || !/^[a-f0-9]{40,64}$/i.test(parts[0]!) || !Number.isFinite(Date.parse(parts[1]!)) || !parts[2]!.trim()) {
      throw new Error('Git-Changelog enthält einen ungültigen Commit.');
    }
    return { hash: parts[0]!, committedAt: parts[1]!, subject: parts[2]! };
  });
}

export function limitChangelogCommits(all: ChangelogCommit[]): { commits: ChangelogCommit[]; moreAvailable: boolean } {
  return { commits: all.slice(0, MAX_VISIBLE), moreAvailable: all.length > MAX_VISIBLE };
}

/** Read-only history of project HEAD, optionally including verified saved card worktrees. */
export async function projectChangelog(store: StudioStore, projectId: string, period: ChangelogPeriod, now = new Date(), scope: ChangelogScope = 'head'): Promise<ProjectChangelog> {
  if (period !== 'day' && period !== 'week') throw new Error('Ungültiger Changelog-Zeitraum.');
  if (scope !== 'head' && scope !== 'saved-worktrees') throw new Error('Ungültige Changelog-Quelle.');
  if (!Number.isFinite(now.getTime())) throw new Error('Ungültiger Prüfzeitpunkt.');
  const project = store.project(projectId);
  const checkedAt = now.toISOString();
  const since = new Date(now.getTime() - (period === 'day' ? 24 : 7 * 24) * 60 * 60 * 1_000).toISOString();
  const evidence = localEvidence(store, projectId, since, checkedAt);
  const integration = integrationEvidence(store, projectId, since, checkedAt);
  const base = { projectId, period, scope, since, until: checkedAt, checkedAt, head: null, commits: [] as ChangelogCommit[], moreAvailable: false,
    issues: [] as ChangelogIssue[], checkedWorktrees: 0, ...evidence,
    integrationReceipts: integration.receipts, integrationTotal: integration.total };
  const inside = await git(project.path, ['rev-parse', '--is-inside-work-tree']);
  if (inside.failed || inside.stdout.trim() !== 'true') return { ...base, state: 'no-repository' };
  const head = await git(project.path, ['rev-parse', '--verify', 'HEAD']);
  if (head.failed) return { ...base, state: 'no-commits' };
  const hash = head.stdout.trim();
  if (!/^[a-f0-9]{40,64}$/i.test(hash)) throw new Error('Git-HEAD ist ungültig.');
  base.integrationReceipts = await verifyIntegrationPresence(project.path, hash, integration);
  const result = await git(project.path, [
    'log', '--no-show-signature', '--no-decorate', '--no-ext-diff', '-z',
    `--since=${since}`, `--until=${checkedAt}`, `--max-count=${MAX_VISIBLE + 1}`,
    '--format=%H%x00%cI%x00%s%x00', 'HEAD',
  ]);
  if (result.failed) throw new Error('Git-Changelog konnte nicht gelesen werden.');
  const all = parseChangelogLog(result.stdout);
  const headHistory = limitChangelogCommits(all);
  const withHeadSource = headHistory.commits.map((commit) => ({ ...commit, sources: [{ kind: 'project-head' as const }] }));
  if (scope === 'head') return { ...base, state: 'ready', head: hash, commits: withHeadSource, moreAvailable: headHistory.moreAvailable };

  const issues: ChangelogIssue[] = [];
  const byHash = new Map<string, ChangelogCommit>(withHeadSource.map((commit) => [commit.hash, commit]));
  const saved = store.cardWorktreesForProject(projectId);
  if (saved.length > MAX_WORKTREES) issues.push({ cardId: null, cardTitle: null, reason: `Nur ${MAX_WORKTREES} von ${saved.length} gespeicherten Karten-Worktrees wurden geprüft.` });
  let checkedWorktrees = 0;
  let moreAvailable = headHistory.moreAvailable;
  const deadline = Date.now() + WORKTREE_BUDGET_MS;
  let projectRoot: string | null = null;
  let commonDir: string | null = null;
  try {
    projectRoot = await checkedGit(project.path, ['rev-parse', '--show-toplevel'], deadline);
    commonDir = await checkedGit(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'], deadline);
  } catch {
    issues.push({ cardId: null, cardTitle: null, reason: 'Git-Ursprung des Projektordners konnte nicht geprüft werden.' });
    return { ...base, state: 'ready', head: hash, commits: withHeadSource, moreAvailable: headHistory.moreAvailable, issues, checkedWorktrees };
  }
  for (const record of saved.slice(0, MAX_WORKTREES)) {
    let cardTitle: string | null = null;
    try {
      cardTitle = store.card(record.cardId).title.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120);
      if (record.projectId !== projectId) throw new Error('Projektzuordnung fehlt.');
      await verifySavedWorktree(store, record, projectRoot, commonDir, deadline);
      const log = await checkedGit(record.path, [
        'log', '--no-show-signature', '--no-decorate', '--no-ext-diff', '-z',
        `--since=${since}`, `--until=${checkedAt}`, `--max-count=${MAX_VISIBLE + 1}`,
        '--format=%H%x00%cI%x00%s%x00', 'HEAD',
      ], deadline);
      const history = limitChangelogCommits(parseChangelogLog(log));
      if (history.moreAvailable) moreAvailable = true;
      const source: ChangelogSource = { kind: 'card-worktree', cardId: record.cardId, cardTitle, branch: record.branch };
      for (const commit of history.commits) {
        const existing = byHash.get(commit.hash);
        if (existing) existing.sources!.push(source);
        else byHash.set(commit.hash, { ...commit, sources: [source] });
      }
      checkedWorktrees++;
    } catch (reason) {
      const message = reason instanceof Error && /Zeitlimit/.test(reason.message) ? 'Zeitlimit für Karten-Worktrees erreicht.' : 'Gespeicherter Karten-Worktree fehlt oder konnte nicht sicher geprüft werden.';
      issues.push({ cardId: record.cardId, cardTitle, reason: message });
      if (Date.now() >= deadline) break;
    }
  }
  const combined = [...byHash.values()].sort((a, b) => Date.parse(b.committedAt) - Date.parse(a.committedAt) || a.hash.localeCompare(b.hash));
  const visible = limitChangelogCommits(combined);
  return { ...base, state: 'ready', head: hash, commits: visible.commits, moreAvailable: moreAvailable || visible.moreAvailable, issues, checkedWorktrees };
}
