import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { limitChangelogCommits, parseChangelogLog, projectChangelog } from '../../src/main/changelog';
import { ensureCardWorktree, worktreeRepositoryKey } from '../../src/main/git-worktree';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function git(cwd: string, args: string[], date?: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  return result.stdout.trim();
}

function fixture(withGit = true) {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-changelog-'));
  roots.push(root);
  const repository = join(root, 'repository');
  mkdirSync(repository);
  if (withGit) git(repository, ['init', '-q']);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic changelog', path: repository });
  return { repository, store, project };
}

function commit(repository: string, index: number, subject: string, date: string) {
  writeFileSync(join(repository, 'tracked.txt'), `revision ${index}\n`);
  git(repository, ['add', 'tracked.txt']);
  git(repository, ['-c', 'user.name=Studio Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', subject], date);
  return git(repository, ['rev-parse', 'HEAD']);
}

describe('project changelog', () => {
  it('reads only reachable HEAD commits in the selected rolling period with exact Git evidence', async () => {
    const { repository, store, project } = fixture();
    try {
      commit(repository, 1, 'Older work', '2026-01-01T10:00:00+00:00');
      const branch = git(repository, ['branch', '--show-current']);
      git(repository, ['checkout', '-qb', 'other-work']);
      const otherHash = commit(repository, 2, 'Unmerged private branch', '2026-01-03T10:00:00+00:00');
      git(repository, ['checkout', '-q', branch]);
      const recentHash = commit(repository, 3, 'Add visible card flow', '2026-01-03T11:00:00+00:00');
      writeFileSync(join(repository, 'untracked.txt'), 'not committed');
      const now = new Date('2026-01-03T12:00:00.000Z');
      const day = await projectChangelog(store, project.id, 'day', now);
      expect(day).toMatchObject({ state: 'ready', period: 'day', scope: 'head', head: recentHash, since: '2026-01-02T12:00:00.000Z', until: now.toISOString(), moreAvailable: false, checkedWorktrees: 0, issues: [] });
      expect(day.commits.map((item) => [item.hash, item.subject])).toEqual([[recentHash, 'Add visible card flow']]);
      expect(day.commits[0]?.authorName).toBe('Studio Test');
      const week = await projectChangelog(store, project.id, 'week', now);
      expect(week.commits).toHaveLength(2);
      expect(week.commits.some((item) => item.hash === otherHash)).toBe(false);
      expect(week.commits.some((item) => item.subject.includes('untracked'))).toBe(false);
    } finally { store.close(); }
  });

  it('includes only verified saved card worktrees on request, deduplicates history and attributes each source', async () => {
    const { repository, store, project } = fixture();
    try {
      const shared = commit(repository, 1, 'Shared foundation', '2026-01-02T09:00:00+00:00');
      const column = store.snapshot(project.id).columns[0]!;
      const first = store.createCard({ projectId: project.id, columnId: column.id, title: 'First card' });
      const second = store.createCard({ projectId: project.id, columnId: column.id, title: 'Second card' });
      const firstWorktree = ensureCardWorktree(store, first.id);
      const secondWorktree = ensureCardWorktree(store, second.id);
      const firstHash = commit(firstWorktree.path, 2, 'First branch work', '2026-01-03T10:00:00+00:00');
      const secondHash = commit(secondWorktree.path, 3, 'Second branch work', '2026-01-03T11:00:00+00:00');
      const unrelated = git(repository, ['branch', '--show-current']);
      git(repository, ['checkout', '-qb', 'unrelated']);
      const unrelatedHash = commit(repository, 4, 'Unregistered branch', '2026-01-03T11:30:00+00:00');
      git(repository, ['checkout', '-q', unrelated]);
      const now = new Date('2026-01-03T12:00:00.000Z');
      const defaultView = await projectChangelog(store, project.id, 'week', now);
      expect(defaultView.commits.map((item) => item.hash)).toEqual([shared]);
      const expanded = await projectChangelog(store, project.id, 'week', now, 'saved-worktrees');
      expect(expanded).toMatchObject({ scope: 'saved-worktrees', checkedWorktrees: 2, issues: [], moreAvailable: false });
      expect(expanded.commits.map((item) => item.hash)).toEqual([secondHash, firstHash, shared]);
      expect(expanded.commits.some((item) => item.hash === unrelatedHash)).toBe(false);
      expect(expanded.commits.find((item) => item.hash === firstHash)?.sources).toEqual([{ kind: 'card-worktree', cardId: first.id, cardTitle: first.title, branch: firstWorktree.branch }]);
      expect(expanded.commits.find((item) => item.hash === shared)?.sources).toEqual([
        { kind: 'project-head' },
        { kind: 'card-worktree', cardId: first.id, cardTitle: first.title, branch: firstWorktree.branch },
        { kind: 'card-worktree', cardId: second.id, cardTitle: second.title, branch: secondWorktree.branch },
      ]);
    } finally { store.close(); }
  });

  it('keeps valid commits visible and marks a missing saved worktree as a partial result', async () => {
    const { repository, store, project } = fixture();
    try {
      const shared = commit(repository, 1, 'Shared foundation', '2026-01-02T09:00:00+00:00');
      const column = store.snapshot(project.id).columns[0]!;
      const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Lost checkout' });
      const worktree = ensureCardWorktree(store, card.id);
      rmSync(worktree.path, { recursive: true, force: true });
      const result = await projectChangelog(store, project.id, 'week', new Date('2026-01-03T12:00:00Z'), 'saved-worktrees');
      expect(result.commits.map((item) => item.hash)).toEqual([shared]);
      expect(result).toMatchObject({ checkedWorktrees: 0, moreAvailable: false });
      expect(result.issues).toEqual([{ cardId: card.id, cardTitle: 'Lost checkout', reason: expect.stringContaining('fehlt') }]);
    } finally { store.close(); }
  });

  it('reads bounded QA and diff-review activity from the selected project and period without attributing it to a commit', async () => {
    const { repository, store, project } = fixture();
    try {
      const head = commit(repository, 1, 'Project work', '2026-01-03T08:00:00+00:00');
      const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Synthetic preview' });
      const otherRoot = join(repository, 'other-project');
      mkdirSync(otherRoot);
      const otherProject = store.createProject({ name: 'Other project', path: otherRoot });
      const otherCard = store.createCard({ projectId: otherProject.id, columnId: store.snapshot(otherProject.id).columns[0]!.id, title: 'Other card' });
        const insertQa = store.db.prepare(`INSERT INTO card_qa_reports
          (id,card_id,project_id,requested_url,started_at,ended_at,status,diagnostics_json,note,viewport_width,viewport_height,page_check,page_observations_json,git_evidence_json)
          VALUES (?,?,?,'http://127.0.0.1:5181/','2026-01-03T09:00:00.000Z',?,?,'[]',NULL,1280,800,'complete','[]',?)`);
        insertQa.run('qa-current', card.id, project.id, '2026-01-03T10:00:00.000Z', 'failed', JSON.stringify({ scope: 'card-worktree', state: 'clean', startHead: head, endHead: head, dirtyAtStart: false, dirtyAtEnd: false }));
        insertQa.run('qa-old', card.id, project.id, '2025-12-20T10:00:00.000Z', 'passed', 'null');
        insertQa.run('qa-other', otherCard.id, otherProject.id, '2026-01-03T10:00:00.000Z', 'passed', 'null');
        store.db.prepare(`INSERT INTO review_comments (id,card_id,fingerprint,file_path,side,line,body,created_at)
          VALUES ('review-current',?,'fingerprint','src/app.ts','new',1,'Check focus','2026-01-03T10:30:00.000Z')`).run(card.id);
        store.db.prepare(`INSERT INTO review_comments (id,card_id,fingerprint,file_path,side,line,body,created_at)
          VALUES ('review-old',?,'fingerprint','src/app.ts','new',1,'Older note','2025-12-20T10:30:00.000Z')`).run(card.id);
        store.db.prepare(`INSERT INTO review_comments (id,card_id,fingerprint,file_path,side,line,body,created_at)
          VALUES ('review-other',?,'fingerprint','src/app.ts','new',1,'Other note','2026-01-03T10:30:00.000Z')`).run(otherCard.id);
        const result = await projectChangelog(store, project.id, 'week', new Date('2026-01-03T12:00:00Z'));
        expect(result.qaTotal).toBe(1);
        expect(result.qaObservations).toEqual([{ id: 'qa-current', cardId: card.id, cardTitle: 'Synthetic preview', endedAt: '2026-01-03T10:00:00.000Z', status: 'failed', checkoutState: 'clean', checkoutHead: head }]);
        expect(result.reviewTotal).toBe(1);
        expect(result.reviewActivity).toEqual([{ cardId: card.id, cardTitle: 'Synthetic preview', count: 1, lastAt: '2026-01-03T10:30:00.000Z' }]);
        expect(result.commits.map((item) => item.hash)).toEqual([head]);
    } finally { store.close(); }
  });

  it('checks a saved integration receipt against the current HEAD and keeps review/test evidence bound to its snapshot', async () => {
    const { repository, store, project } = fixture();
    try {
      const base = commit(repository, 1, 'Base', '2026-01-02T09:00:00+00:00');
      const landed = commit(repository, 2, 'Add synthetic flow', '2026-01-03T10:00:00+00:00');
      const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Visible flow' });
      const fingerprint = 'f'.repeat(64);
      const row = store.db.prepare(`INSERT INTO integration_items
        (project_id,card_id,repository_key,target_branch,source_head,target_head,card_fingerprint,preview_token,state,reason,created_at,updated_at,integrated_head,approval_mode)
        VALUES (?,?,?,?,?,?,?,NULL,'integrated',NULL,?,?,?,'manual')`)
        .run(project.id, card.id, worktreeRepositoryKey(repository), git(repository, ['branch', '--show-current']),
          landed, base, fingerprint, '2026-01-03T09:00:00.000Z', '2026-01-03T11:00:00.000Z', landed);
      store.db.prepare(`INSERT INTO integration_reviews (item_id,card_id,source_head,target_head,card_fingerprint,reviewed_at)
        VALUES (?,?,?,?,?,'2026-01-03T10:15:00.000Z')`).run(row.lastInsertRowid, card.id, landed, base, fingerprint);
      store.db.prepare(`INSERT INTO integration_test_runs
        (item_id,card_id,source_head,target_head,card_fingerprint,script_name,script_hash,state,exit_code,output_tail,started_at,ended_at)
        VALUES (?,?,?,?,?,'test:integration','script-hash','passed',0,'synthetic','2026-01-03T10:20:00.000Z','2026-01-03T10:21:00.000Z')`)
        .run(row.lastInsertRowid, card.id, landed, base, fingerprint);
      const now = new Date('2026-01-03T12:00:00.000Z');
      const present = await projectChangelog(store, project.id, 'week', now);
      expect(present.integrationTotal).toBe(1);
      expect(present.integrationReceipts).toEqual([{ cardId: card.id, cardTitle: 'Visible flow', integratedAt: '2026-01-03T11:00:00.000Z',
        integratedHead: landed, targetBranch: expect.any(String), approvalMode: 'manual', headPresence: 'present',
        review: { reviewedAt: '2026-01-03T10:15:00.000Z', matchesSnapshot: true },
        test: { scriptName: 'test:integration', state: 'passed', exitCode: 0, matchesSnapshot: true } }]);
      git(repository, ['reset', '--hard', base]);
      store.db.prepare('UPDATE integration_test_runs SET card_fingerprint = ? WHERE item_id = ?').run('e'.repeat(64), row.lastInsertRowid);
      const missing = await projectChangelog(store, project.id, 'week', now);
      expect(missing.integrationReceipts[0]).toMatchObject({ headPresence: 'missing', test: { matchesSnapshot: false } });
    } finally { store.close(); }
  });

  it('does not trust a saved card checkout after its Git branch changes', async () => {
    const { repository, store, project } = fixture();
    try {
      const shared = commit(repository, 1, 'Shared foundation', '2026-01-02T09:00:00+00:00');
      const column = store.snapshot(project.id).columns[0]!;
      const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Moved branch' });
      const worktree = ensureCardWorktree(store, card.id);
      git(worktree.path, ['checkout', '-qb', 'different-branch']);
      const movedHash = commit(worktree.path, 2, 'Unverified change', '2026-01-03T10:00:00+00:00');
      const result = await projectChangelog(store, project.id, 'week', new Date('2026-01-03T12:00:00Z'), 'saved-worktrees');
      expect(result.commits.map((item) => item.hash)).toEqual([shared]);
      expect(result.commits.some((item) => item.hash === movedHash)).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.checkedWorktrees).toBe(0);
    } finally { store.close(); }
  });

  it('limits saved worktree checks and reports that additional card sources were not examined', async () => {
    const { repository, store, project } = fixture();
    try {
      commit(repository, 1, 'Shared foundation', '2026-01-02T09:00:00+00:00');
      const column = store.snapshot(project.id).columns[0]!;
      for (let index = 0; index < 13; index++) {
        const card = store.createCard({ projectId: project.id, columnId: column.id, title: `Saved card ${index}` });
        store.saveCardWorktree({ cardId: card.id, projectId: project.id, sourceRoot: repository,
          path: join(store.worktreeBase, project.id, card.id), branch: `jarvis/card-${card.id}` });
      }
      const result = await projectChangelog(store, project.id, 'week', new Date('2026-01-03T12:00:00Z'), 'saved-worktrees');
      expect(result.checkedWorktrees).toBe(0);
      expect(result.issues).toHaveLength(13);
      expect(result.issues[0]?.reason).toContain('Nur 12 von 13');
      expect(result.moreAvailable).toBe(false);
    } finally { store.close(); }
  });

  it('distinguishes non-Git projects and unborn repositories, and rejects bad periods', async () => {
    const without = fixture(false);
    try { expect((await projectChangelog(without.store, without.project.id, 'week')).state).toBe('no-repository'); }
    finally { without.store.close(); }
    const unborn = fixture();
    try {
      expect((await projectChangelog(unborn.store, unborn.project.id, 'week')).state).toBe('no-commits');
      await expect(projectChangelog(unborn.store, unborn.project.id, 'month' as 'week')).rejects.toThrow('Ungültiger');
      await expect(projectChangelog(unborn.store, unborn.project.id, 'week', new Date(), 'invalid' as 'head')).rejects.toThrow('Quelle');
    } finally { unborn.store.close(); }
  });

  it('bounds a large history and reports when commits are hidden', () => {
    const all = Array.from({ length: 101 }, (_, index) => ({ hash: 'a'.repeat(40), committedAt: '2026-01-03T11:00:00Z', subject: `Revision ${101 - index}` }));
    const result = limitChangelogCommits(all);
    expect(result.commits).toHaveLength(100);
    expect(result.moreAvailable).toBe(true);
    expect(result.commits[0]?.subject).toBe('Revision 101');
  });

  it('rejects truncated and malformed Git records', () => {
    expect(() => parseChangelogLog('bad')).toThrow('unvollständig');
    expect(() => parseChangelogLog('bad\0date\0subject\0\0')).toThrow('ungültigen Commit');
    expect(parseChangelogLog(`${'a'.repeat(40)}\0${'2026-01-03T11:00:00Z'}\0Alex Git\0Commit\0\0`)[0]).toMatchObject({ authorName: 'Alex Git', subject: 'Commit' });
    expect(parseChangelogLog(`${'a'.repeat(40)}\0${'2026-01-03T11:00:00Z'}\0Legacy commit\0\0`)[0]).toMatchObject({ subject: 'Legacy commit' });
  });
});
