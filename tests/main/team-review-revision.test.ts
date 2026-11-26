import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { createTeamReviewRoom, teamReviewRevision } from '../../src/main/team-review';
import { TeamReviewHttp } from '../../src/main/team-review-http';
import { ensureCardWorktree } from '../../src/main/git-worktree';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout.trim();
}

it('marks a saved screenshot review when its Git checkout becomes dirty or moves to another HEAD', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-review-revision-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'tracked.txt'), 'first\n');
  git(repo, 'add', 'tracked.txt');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'first');
  const firstHead = git(repo, 'rev-parse', 'HEAD');
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const listener = new TeamReviewHttp(store);
  try {
    const project = store.createProject({ name: 'Synthetic review', path: repo });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Review settings' });
    const reportId = 'synthetic-report';
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GxQAAAAASUVORK5CYII=', 'base64');
    const cleanEvidence = { scope: 'project', startHead: firstHead, endHead: firstHead,
      dirtyAtStart: false, dirtyAtEnd: false, state: 'clean' };
    store.db.prepare(`INSERT INTO card_qa_reports
      (id, card_id, project_id, requested_url, started_at, ended_at, status, diagnostics_json, viewport_width, viewport_height, git_evidence_json, screenshot_png)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(reportId, card.id, project.id, 'http://127.0.0.1:5181/settings',
      '2026-01-01T10:00:00Z', '2026-01-01T10:00:05Z', 'passed', '[]', 1200, 800, JSON.stringify(cleanEvidence), image);
    const created = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId,
      scenario: 'Settings without sign-in', reviewerName: 'Alex' });
    const room = created.room;
    expect(await teamReviewRevision(store, room.id)).toMatchObject({ status: 'same-clean-head', currentHead: firstHead });
    await listener.start();
    const guest = await fetch(listener.reviewUrl(created.reviewerSecret).replace('/r/', '/api/r/'));
    expect(guest.status).toBe(200);
    expect((await guest.json()).revision).toMatchObject({ status: 'same-clean-head', currentHead: firstHead });
    writeFileSync(join(repo, 'tracked.txt'), 'modified\n');
    expect(await teamReviewRevision(store, room.id)).toMatchObject({ status: 'working-tree-dirty', currentHead: firstHead });
    git(repo, 'add', 'tracked.txt');
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'second');
    expect(await teamReviewRevision(store, room.id)).toMatchObject({ status: 'different-head', currentHead: git(repo, 'rev-parse', 'HEAD') });
    store.db.prepare('UPDATE card_qa_reports SET git_evidence_json = ? WHERE id = ?').run(JSON.stringify({ ...cleanEvidence, state: 'dirty', dirtyAtEnd: true }), reportId);
    const uncertain = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId,
      scenario: 'Dirty QA checkout', reviewerName: 'Sam' }).room;
    expect(await teamReviewRevision(store, uncertain.id)).toMatchObject({ status: 'unavailable' });
    ensureCardWorktree(store, card.id);
    expect(await teamReviewRevision(store, room.id)).toMatchObject({ status: 'checkout-changed' });
  } finally { listener.close(); store.close(); }
});
