import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createTeamBoardInvite, resolveTeamBoardInvite, revokeTeamBoardInvite, teamBoardInvites, teamBoardSnapshot } from '../../src/main/team-board';
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
});
