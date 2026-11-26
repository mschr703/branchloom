import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { addTeamBoardComment, createTeamBoardInvite, teamBoardCardComments, teamBoardComments } from '../../src/main/team-board';
import { acknowledgeGuestInboxComment, reviewInboxItems } from '../../src/main/review-inbox';
import { globalInboxItems } from '../../src/main/global-inbox';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('guest feedback in the decision inbox', () => {
  it('shows project and global sources, searches them, and keeps acknowledgement after restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-guest-inbox-'));
    roots.push(root);
    const file = join(root, 'studio.sqlite');
    const store = new StudioStore(file);
    const project = store.createProject({ name: 'Sample project', path: root });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Settings page' });
    const guest = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Alex', canComment: true });
    const comment = addTeamBoardComment(store, { secret: guest.secret, cardId: card.id, body: 'Please verify the empty state.', clientMutationId: 'request_12345678' });
    const projectItem = reviewInboxItems(store, { projectId: project.id }).items.find((item) => item.id === comment.id);
    expect(projectItem).toMatchObject({ kind: 'guest', sourceId: card.id, sourceTitle: 'Settings page', location: 'Gastfeedback von Alex', body: comment.body });
    expect(reviewInboxItems(store, { projectId: project.id, query: 'EMPTY STATE' }).items.map((item) => item.id)).toEqual([comment.id]);
    expect(globalInboxItems(store, { category: 'review', query: 'alex' }).items).toEqual([
      expect.objectContaining({ id: `guest:${comment.id}`, kind: 'guest', projectId: project.id, sourceId: card.id, detail: expect.stringContaining(comment.body) }),
    ]);
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(reviewInboxItems(store, { projectId: other.id }).items).toEqual([]);
    expect(teamBoardCardComments(store, { projectId: project.id, cardId: card.id })).toEqual([comment]);
    expect(() => teamBoardCardComments(store, { projectId: other.id, cardId: card.id })).toThrow('this project');
    expect(() => acknowledgeGuestInboxComment(store, { projectId: other.id, commentId: comment.id })).toThrow('active project');
    expect(() => acknowledgeGuestInboxComment(store, { projectId: project.id, commentId: 'missing' })).toThrow('active project');
    acknowledgeGuestInboxComment(store, { projectId: project.id, commentId: comment.id });
    acknowledgeGuestInboxComment(store, { projectId: project.id, commentId: comment.id });
    expect(reviewInboxItems(store, { projectId: project.id }).items).toEqual([]);
    expect(globalInboxItems(store).items).toEqual([]);
    expect(teamBoardComments(store, project.id)).toHaveLength(1);
    expect(store.snapshot(project.id).sessions).toEqual([]);
    store.close();
    const reopened = new StudioStore(file);
    expect(reviewInboxItems(reopened, { projectId: project.id }).items).toEqual([]);
    expect(teamBoardComments(reopened, project.id)).toHaveLength(1);
    reopened.close();
  });

  it('excludes archived cards and installs the acknowledgement table in an older database', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-guest-inbox-migration-'));
    roots.push(root);
    const file = join(root, 'studio.sqlite');
    const store = new StudioStore(file);
    const project = store.createProject({ name: 'Sample', path: root });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Archived page' });
    const guest = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Sam', canComment: true });
    const comment = addTeamBoardComment(store, { secret: guest.secret, cardId: card.id, body: 'Review this.', clientMutationId: 'request_abcdefgh' });
    store.db.exec('DROP TABLE guest_inbox_acknowledgements');
    store.close();
    const reopened = new StudioStore(file);
    expect(reviewInboxItems(reopened, { projectId: project.id }).items.map((item) => item.id)).toEqual([comment.id]);
    reopened.db.prepare('UPDATE cards SET archived_at=? WHERE id=?').run(new Date().toISOString(), card.id);
    expect(reviewInboxItems(reopened, { projectId: project.id }).items).toEqual([]);
    expect(globalInboxItems(reopened).items).toEqual([]);
    expect(() => acknowledgeGuestInboxComment(reopened, { projectId: project.id, commentId: comment.id })).toThrow('active project');
    reopened.close();
  });
});
