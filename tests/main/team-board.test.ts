import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { addTeamBoardComment, createTeamBoardInvite, resolveTeamBoardInvite, revokeTeamBoardInvite, teamBoardComments, teamBoardInvites, teamBoardSnapshot } from '../../src/main/team-board';
import { TeamBoardHttp } from '../../src/main/team-board-http';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-board-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic project', path: root });
  const columns = store.snapshot(project.id).columns;
  const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Settings page' });
  return { root, dbPath, store, project, columns, card };
}

describe('read-only team board invitation', () => {
  it('upgrades an existing viewer-only invitation table without granting comment rights', () => {
    const { dbPath, store, project } = fixture();
    store.db.exec(`DROP TABLE team_board_comments; DROP TABLE team_board_invites;
      CREATE TABLE team_board_invites (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role = 'viewer'), secret_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
      );`);
    store.db.prepare(`INSERT INTO team_board_invites VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('old', project.id, 'Earlier guest', 'viewer', 'old-hash', '2026-11-25T08:00:00.000Z', '2026-11-27T08:00:00.000Z', null);
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(teamBoardInvites(reopened, project.id)[0]).toMatchObject({ displayName: 'Earlier guest', canComment: false });
    expect(teamBoardInvites(reopened, project.id)[0]?.revokedAt).not.toBeNull();
    const newer = createTeamBoardInvite(reopened, { projectId: project.id, displayName: 'New commenter', canComment: true });
    expect(newer.invite.canComment).toBe(true);
    reopened.close();
  });

  it('projects only board and running-session metadata, redacts known secrets, and scopes cards to one project', () => {
    const { root, store, project, columns, card } = fixture();
    const secretTitle = store.createCard({ projectId: project.id, columnId: columns[0]!.id,
      title: `Token sk-${'a'.repeat(24)}`, description: 'Private description C:\\Users\\someone\\profile' });
    store.createSession({ cardId: card.id, agentId: store.agents()[0]!.id, worktreePath: 'C:\\Users\\someone\\worktree' });
    mkdirSync(join(root, 'other'));
    const other = store.createProject({ name: 'Other project', path: join(root, 'other') });
    store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Other project card' });
    const view = teamBoardSnapshot(store, project.id);
    expect(view.cards).toHaveLength(2);
    expect(view.cards.find((item) => item.id === card.id)?.runningSince).toBeTruthy();
    expect(view.cards.find((item) => item.id === secretTitle.id)?.title).toBe('[Sensitive title hidden]');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('Private description');
    expect(serialized).not.toContain('worktree');
    expect(serialized).not.toContain('Other project card');
    expect(serialized).not.toContain('sk-');
    store.close();
  });

  it('rejects foreign revocation, expires access, and ends old invitations on restart', () => {
    const { root, dbPath, store, project } = fixture();
    const first = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Alex' });
    expect(resolveTeamBoardInvite(store, first.secret).projectId).toBe(project.id);
    expect(JSON.stringify(teamBoardInvites(store, project.id))).not.toContain(first.secret);
    mkdirSync(join(root, 'other'));
    const other = store.createProject({ name: 'Other', path: join(root, 'other') });
    expect(() => revokeTeamBoardInvite(store, { projectId: other.id, inviteId: first.invite.id })).toThrow('this project');
    store.db.prepare('UPDATE team_board_invites SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', first.invite.id);
    expect(() => resolveTeamBoardInvite(store, first.secret)).toThrow('unavailable');
    const second = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Sam' });
    expect(revokeTeamBoardInvite(store, { projectId: project.id, inviteId: second.invite.id }).revokedAt).not.toBeNull();
    expect(() => resolveTeamBoardInvite(store, second.secret)).toThrow('unavailable');
    const third = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Taylor' });
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(() => resolveTeamBoardInvite(reopened, third.secret)).toThrow('unavailable');
    expect(teamBoardInvites(reopened, project.id).find((item) => item.id === third.invite.id)?.revokedAt).not.toBeNull();
    reopened.close();
  });

  it('serves two guests the latest project board and never exposes a write endpoint', async () => {
    const { store, project, columns, card } = fixture();
    const listener = new TeamBoardHttp(store);
    try {
      await listener.start();
      const alex = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Alex' });
      const sam = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Sam' });
      listener.allowSecret(alex.secret); listener.allowSecret(sam.secret);
      const page = await fetch(listener.url(alex.secret));
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(await page.text()).toContain(`/board/${alex.secret}/app.js`);
      const dataUrl = (secret: string) => listener.url(secret).replace('/board/', '/api/board/');
      const alexDataUrl = dataUrl(alex.secret);
      const samDataUrl = dataUrl(sam.secret);
      const first = await (await fetch(alexDataUrl)).json() as { cards: Array<{ id: string; title: string }> };
      expect(first.cards.map((item) => item.id)).toContain(card.id);
      store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'New task' });
      const second = await (await fetch(samDataUrl)).json() as { cards: Array<{ title: string }> };
      expect(second.cards.map((item) => item.title)).toContain('New task');
      expect((await fetch(alexDataUrl, { method: 'POST' })).status).toBe(405);
      expect((await fetch(samDataUrl.replace(sam.secret, 'A'.repeat(43)))).status).toBe(403);
      revokeTeamBoardInvite(store, { projectId: project.id, inviteId: alex.invite.id });
      expect((await fetch(alexDataUrl)).status).toBe(403);
      expect((await fetch(samDataUrl)).status).toBe(200);
    } finally { listener.close(); store.close(); }
  });

  it('allows only an explicitly permitted guest to comment on a card in the shared project, with idempotent retries', () => {
    const { root, store, project, card } = fixture();
    const viewer = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Viewer' });
    const writer = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Writer', canComment: true });
    expect(viewer.invite.canComment).toBe(false);
    expect(writer.invite.canComment).toBe(true);
    const input = { secret: writer.secret, cardId: card.id, body: 'Please check the empty state.', clientMutationId: 'request_12345678' };
    expect(() => addTeamBoardComment(store, { ...input, secret: viewer.secret })).toThrow('cannot comment');
    const first = addTeamBoardComment(store, input);
    expect(addTeamBoardComment(store, input).id).toBe(first.id);
    expect(() => addTeamBoardComment(store, { ...input, body: 'Different text' })).toThrow('already used');
    store.db.prepare('UPDATE cards SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), card.id);
    expect(addTeamBoardComment(store, input).id).toBe(first.id);
    expect(() => addTeamBoardComment(store, { ...input, clientMutationId: 'request_77777777' })).toThrow('unavailable');
    mkdirSync(join(root, 'other'));
    const other = store.createProject({ name: 'Other', path: join(root, 'other') });
    const otherCard = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Private card' });
    expect(() => addTeamBoardComment(store, { ...input, cardId: otherCard.id, clientMutationId: 'request_87654321' })).toThrow('unavailable');
    expect(teamBoardComments(store, project.id)).toEqual([first]);
    expect(teamBoardComments(store, other.id)).toEqual([]);
    revokeTeamBoardInvite(store, { projectId: project.id, inviteId: writer.invite.id });
    expect(() => addTeamBoardComment(store, input)).toThrow('unavailable');
    store.close();
  });

  it('keeps read-only HTTP links read-only and accepts comment posts only from the guest page origin', async () => {
    const { store, project, card } = fixture();
    const listener = new TeamBoardHttp(store);
    try {
      await listener.start();
      const viewer = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Viewer' });
      const writer = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Writer', canComment: true });
      listener.allowSecret(viewer.secret); listener.allowSecret(writer.secret);
      const route = (secret: string) => listener.url(secret).replace('/board/', '/api/board/') + '/comments';
      const origin = new URL(listener.url(writer.secret)).origin;
      const writerRoute = route(writer.secret);
      const body = JSON.stringify({ cardId: card.id, body: 'Check labels', clientMutationId: 'request_12345678' });
      const post = (url: string, suppliedOrigin?: string) => fetch(url, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(suppliedOrigin ? { Origin: suppliedOrigin } : {}) }, body });
      expect((await post(route(viewer.secret), origin)).status).toBe(403);
      expect((await post(writerRoute)).status).toBe(403);
      expect((await post(writerRoute, 'http://evil.example')).status).toBe(403);
      const sent = await post(writerRoute, origin);
      expect(sent.status).toBe(200);
      expect((await sent.json() as { comment: { cardId: string } }).comment.cardId).toBe(card.id);
      expect((await post(writerRoute, origin)).status).toBe(200);
      expect(teamBoardComments(store, project.id)).toHaveLength(1);
      revokeTeamBoardInvite(store, { projectId: project.id, inviteId: writer.invite.id });
      expect((await post(writerRoute, origin)).status).toBe(403);
    } finally { listener.close(); store.close(); }
  });
});
