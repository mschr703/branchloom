import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { StudioStore } from '../../src/main/store';
import { addTeamReviewComment, closeTeamReviewRoom, createTeamReviewInvite, createTeamReviewRoom, resolveTeamReviewInvite, revokeTeamReviewInvite, teamReviewComments, teamReviewImage, teamReviewInvites, teamReviewRoom } from '../../src/main/team-review';
import { TeamReviewHttp } from '../../src/main/team-review-http';
import { teamReviewHtml, teamReviewJs } from '../../src/main/team-review-page';

const roots: string[] = [];
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GxQAAAAASUVORK5CYII=', 'base64');
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-review-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Review settings' });
  const reportId = 'synthetic-qa-report';
  store.db.prepare(`INSERT INTO card_qa_reports
    (id, card_id, project_id, requested_url, started_at, ended_at, status, diagnostics_json, viewport_width, viewport_height, git_evidence_json, screenshot_png)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(reportId, card.id, project.id, 'http://127.0.0.1:5173/settings',
      '2026-01-01T10:00:00Z', '2026-01-01T10:00:05Z', 'passed', '[]', 1200, 800,
      JSON.stringify({ scope: 'project', startHead: 'a'.repeat(40), endHead: 'a'.repeat(40), dirtyAtStart: false, dirtyAtEnd: false, state: 'clean' }), image);
  return { root, dbPath, store, project, card, reportId };
}

it('keeps an immutable shared image and revision observation after the QA report changes', () => {
  const { dbPath, store, project, card, reportId } = fixture();
  const created = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId, scenario: 'Signed out settings', reviewerName: 'Alex' });
  expect(created.room.imageWidth).toBe(1);
  expect(created.room.imageHeight).toBe(1);
  expect(teamReviewImage(store, created.room.id)).toEqual(image);
  expect(created.room.checkoutObservation?.endHead).toBe('a'.repeat(40));
  store.db.prepare('UPDATE card_qa_reports SET screenshot_png = NULL, git_evidence_json = ? WHERE id = ?').run('null', reportId);
  store.close();
  const reopened = new StudioStore(dbPath);
  expect(teamReviewImage(reopened, created.room.id)).toEqual(image);
  expect(teamReviewRoom(reopened, created.room.id)).toEqual(created.room);
  expect(resolveTeamReviewInvite(reopened, created.reviewerSecret).invite.displayName).toBe('Alex');
  reopened.close();
});

it('deduplicates a reconnect retry, binds comments to the card and image, and rejects changed retry content', () => {
  const { store, project, card, reportId } = fixture();
  const created = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId, scenario: 'Signed out settings', reviewerName: 'Alex' });
  const input = { reviewerSecret: created.reviewerSecret, clientMutationId: 'review-click-001', body: 'Label is unclear', x: 0.42, y: 0.61 };
  const first = addTeamReviewComment(store, input);
  expect(addTeamReviewComment(store, input)).toEqual(first);
  expect(teamReviewComments(store, created.room.id)).toEqual([first]);
  expect(first).toMatchObject({ cardId: card.id, imageSha256: created.room.imageSha256, displayName: 'Alex' });
  expect(() => addTeamReviewComment(store, { ...input, body: 'Different text' })).toThrow('already used');
  expect(() => addTeamReviewComment(store, { ...input, clientMutationId: 'review-click-002', x: 1.1 })).toThrow('invalid');
  store.close();
});

it('revokes reviewer access and rejects a foreign card or missing screenshot', () => {
  const { store, root, project, card, reportId } = fixture();
  const created = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId, scenario: 'Signed out settings', reviewerName: 'Alex' });
  const second = createTeamReviewInvite(store, { roomId: created.room.id, reviewerName: 'Sam' });
  expect(teamReviewInvites(store, created.room.id).map((item) => item.displayName)).toEqual(['Alex', 'Sam']);
  expect(resolveTeamReviewInvite(store, second.reviewerSecret).invite.displayName).toBe('Sam');
  revokeTeamReviewInvite(store, { roomId: created.room.id, inviteId: created.invite.id });
  expect(() => resolveTeamReviewInvite(store, created.reviewerSecret)).toThrow('unavailable');
  mkdirSync(join(root, 'other'));
  const other = store.createProject({ name: 'Other', path: join(root, 'other') });
  expect(() => createTeamReviewRoom(store, { projectId: other.id, cardId: card.id, qaReportId: reportId, scenario: 'Foreign', reviewerName: 'Alex' })).toThrow('another project');
  store.db.prepare('UPDATE card_qa_reports SET screenshot_png = NULL WHERE id = ?').run(reportId);
  expect(() => createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId, scenario: 'No image', reviewerName: 'Alex' })).toThrow('screenshot');
  store.close();
});

it('stops new review comments when a room is closed', () => {
  const { store, project, card, reportId } = fixture();
  const created = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId, scenario: 'Signed out settings', reviewerName: 'Alex' });
  const submitted = { reviewerSecret: created.reviewerSecret, clientMutationId: 'review-click-004', body: 'Already saved', x: 0.2, y: 0.3 };
  const saved = addTeamReviewComment(store, submitted);
  expect(closeTeamReviewRoom(store, created.room.id).closedAt).not.toBeNull();
  expect(resolveTeamReviewInvite(store, created.reviewerSecret).room.closedAt).not.toBeNull();
  expect(addTeamReviewComment(store, submitted)).toEqual(saved);
  expect(() => addTeamReviewComment(store, { reviewerSecret: created.reviewerSecret, clientMutationId: 'review-click-003', body: 'Too late', x: 0.2, y: 0.3 })).toThrow('closed');
  store.close();
});

it('serves one scoped review snapshot and denies agent actions to a reviewer', async () => {
  const { store, project, card, reportId } = fixture();
  const created = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId, scenario: 'Signed out settings', reviewerName: 'Alex' });
  const listener = new TeamReviewHttp(store);
  try {
    const [base, simultaneousBase] = await Promise.all([listener.start(), listener.start()]);
    expect(simultaneousBase).toBe(base);
    const url = listener.reviewUrl(created.reviewerSecret);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Shared review');
    const data = await fetch(`${base}/api/r/${created.reviewerSecret}`);
    expect(data.status).toBe(200);
    expect((await data.json()).room.imageSha256).toBe(created.room.imageSha256);
    const screenshot = await fetch(`${base}/api/r/${created.reviewerSecret}/image`);
    expect(Buffer.from(await screenshot.arrayBuffer())).toEqual(image);
    const body = JSON.stringify({ clientMutationId: 'http-comment-001', body: 'Improve this label', x: 0.2, y: 0.3 });
    const options = { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body };
    expect((await fetch(`${base}/api/r/${created.reviewerSecret}/comments`, options)).status).toBe(200);
    expect((await fetch(`${base}/api/r/${created.reviewerSecret}/comments`, options)).status).toBe(200);
    expect(teamReviewComments(store, created.room.id)).toHaveLength(1);
    expect((await fetch(`${base}/api/r/${created.reviewerSecret}/agent/start`, options)).status).toBe(404);
    expect((await fetch(`${base}/api/r/${created.reviewerSecret}/comments`, { ...options, headers: { Origin: 'http://elsewhere.invalid', 'Content-Type': 'application/json' } })).status).toBe(403);
    const malformed = await fetch(`${base}/api/r/${created.reviewerSecret}/comments`, { ...options, body: '{broken' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Review request failed.' });
  } finally { listener.close(); store.close(); }
});

it('keeps two independent guest pages on the same image and exchanges a point comment', async () => {
  const { store, project, card, reportId } = fixture();
  const created = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId, scenario: 'Signed out settings', reviewerName: 'Alex' });
  const second = createTeamReviewInvite(store, { roomId: created.room.id, reviewerName: 'Sam' });
  const listener = new TeamReviewHttp(store);
  const guests: JSDOM[] = [];
  const waitFor = async (check: () => boolean) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Guest page did not reach the expected state.');
  };
  try {
    await listener.start();
    const openGuest = (secret: string) => {
      const url = listener.reviewUrl(secret);
      const guest = new JSDOM(teamReviewHtml, { url, runScripts: 'outside-only' });
      guests.push(guest);
      const { window } = guest;
      Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
      Object.assign(window, {
        fetch: (path: string, options?: RequestInit) => fetch(new URL(path, url), {
          ...options,
          headers: { ...options?.headers, ...(options?.method === 'POST' ? { Origin: new URL(url).origin } : {}) },
        }),
      });
      window.eval(teamReviewJs);
      return window;
    };
    const alex = openGuest(created.reviewerSecret);
    const sam = openGuest(second.reviewerSecret);
    await waitFor(() => alex.document.getElementById('scenario')?.textContent === 'Signed out settings'
      && sam.document.getElementById('scenario')?.textContent === 'Signed out settings');
    expect(alex.document.getElementById('review-image')?.getAttribute('src'))
      .toBe(`/api/r/${created.reviewerSecret}/image`);
    expect(sam.document.getElementById('review-image')?.getAttribute('src'))
      .toBe(`/api/r/${second.reviewerSecret}/image`);

    const screenshot = alex.document.getElementById('review-image')!;
    screenshot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
    screenshot.dispatchEvent(new alex.MouseEvent('click', { bubbles: true, clientX: 50, clientY: 75 }));
    const field = alex.document.getElementById('comment-body') as HTMLTextAreaElement;
    field.value = 'The label is unclear';
    alex.document.getElementById('comment-form')!.dispatchEvent(new alex.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => teamReviewComments(store, created.room.id).length === 1);
    sam.dispatchEvent(new sam.Event('online'));
    await waitFor(() => sam.document.querySelectorAll('#comments li').length === 1);
    expect(sam.document.querySelector('#comments li')?.textContent).toContain('The label is unclear');
    expect(sam.document.querySelector<HTMLElement>('#markers .marker')?.style.left).toBe('25%');
    expect(sam.document.querySelector<HTMLElement>('#markers .marker')?.style.top).toBe('75%');
    expect(teamReviewComments(store, created.room.id)[0]).toMatchObject({ cardId: card.id, displayName: 'Alex' });
    revokeTeamReviewInvite(store, { roomId: created.room.id, inviteId: second.invite.id });
    sam.dispatchEvent(new sam.Event('online'));
    await waitFor(() => sam.document.getElementById('room-state')?.textContent === 'Invitation unavailable');
    expect(sam.document.getElementById('review-image')?.hasAttribute('src')).toBe(false);
    expect(sam.document.querySelectorAll('#comments li')).toHaveLength(0);
  } finally {
    for (const guest of guests) guest.window.close();
    listener.close();
    store.close();
  }
});
