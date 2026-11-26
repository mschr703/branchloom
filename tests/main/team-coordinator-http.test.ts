import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TeamCoordinatorHttp } from '../../src/main/team-coordinator-http';
import { acceptTeamMemberInvite, createTeamMemberInvite, createTeamWorkspace, revokeTeamMember,
  setTeamCapabilityGrant } from '../../src/main/team-workspace';
import { StudioStore } from '../../src/main/store';

it('authenticates two separate HTTP clients, rejects stale writes, and survives coordinator restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-coordinator-'));
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  let coordinator: TeamCoordinatorHttp | null = null;
  try {
    const project = store.createProject({ name: 'Synthetic project', path: root });
    const column = store.snapshot(project.id).columns[0]!;
    const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Synthetic task' });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Sample team', projectId: project.id, ownerName: 'Owner' });
    const editor = acceptTeamMemberInvite(store.db,
      createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'editor').secret, 'Colleague');
    const viewer = acceptTeamMemberInvite(store.db,
      createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'viewer').secret, 'Observer');
    coordinator = new TeamCoordinatorHttp(store);
    let base = await coordinator.start();
    const getBoard = (key: string, projectId = project.id) => fetch(`${base}/v1/projects/${projectId}/board`,
      { headers: { Authorization: `Bearer ${key}` } });
    const getWorkspace = (key: string) => fetch(`${base}/v1/workspace`,
      { headers: { Authorization: `Bearer ${key}` } });
    const setPriority = (key: string, priority: string, expectedRevision: number, mutationId: string) =>
      fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/priority`, { method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority, expectedRevision, mutationId }) });
    const firstBoard = await getBoard(owner.credential);
    const secondBoard = await getBoard(editor.credential);
    expect(firstBoard.status).toBe(200);
    expect(secondBoard.status).toBe(200);
    expect((await (await getWorkspace(owner.credential)).json()).projects).toEqual([{ id: project.id, name: project.name }]);
    expect((await (await getWorkspace(editor.credential)).json()).projects).toEqual([{ id: project.id, name: project.name }]);
    expect((await firstBoard.json()).cards[0].id).toBe(card.id);
    expect((await secondBoard.json()).cards[0].id).toBe(card.id);
    expect((await getBoard(editor.credential, randomUUID())).status).toBe(403);
    expect((await getBoard('wrong')).status).toBe(401);
    expect((await fetch(`${base}/v1/workspace`, { headers: { Authorization: `Bearer ${owner.credential}`,
      Origin: 'https://untrusted.example' } })).status).toBe(403);
    expect((await fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/priority`, { method: 'POST',
      headers: { Authorization: `Bearer ${owner.credential}`, 'Content-Type': 'application/json' },
      body: '{invalid' })).status).toBe(400);
    const ownerMutation = randomUUID();
    expect((await setPriority(owner.credential, 'high', 0, ownerMutation)).status).toBe(200);
    expect((await setPriority(editor.credential, 'urgent', 0, randomUUID())).status).toBe(403);
    setTeamCapabilityGrant(store.db, owner.credential, project.id, editor.member.id, 'manage_task', true);
    expect((await setPriority(editor.credential, 'urgent', 0, randomUUID())).status).toBe(409);
    expect((await setPriority(viewer.credential, 'urgent', 1, randomUUID())).status).toBe(403);
    const retry = await setPriority(owner.credential, 'high', 0, ownerMutation);
    expect(retry.status).toBe(200);
    expect((await retry.json()).repeated).toBe(true);
    await coordinator.close();
    coordinator = new TeamCoordinatorHttp(store);
    base = await coordinator.start();
    expect((await getBoard(editor.credential)).status).toBe(200);
    expect((await setPriority(editor.credential, 'urgent', 1, randomUUID())).status).toBe(200);
    expect(store.card(card.id).priority).toBe('urgent');
    revokeTeamMember(store.db, owner.credential, editor.member.id);
    expect((await getBoard(editor.credential)).status).toBe(401);
    expect((await setPriority(editor.credential, 'low', 2, randomUUID())).status).toBe(401);
  } finally {
    await coordinator?.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
