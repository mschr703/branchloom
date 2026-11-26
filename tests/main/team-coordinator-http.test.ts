import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TeamCoordinatorHttp } from '../../src/main/team-coordinator-http';
import { acceptTeamMemberInvite, addTeamProject, createTeamMemberInvite, createTeamWorkspace,
  setTeamCapabilityGrant, setTeamProjectAccess,
  type TeamMember } from '../../src/main/team-workspace';
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
    coordinator = new TeamCoordinatorHttp(store);
    let base = await coordinator.start();
    const invite = async (role: 'editor' | 'viewer', credential = owner.credential) => fetch(`${base}/v1/workspace/invitations`,
      { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }) });
    const accept = async (secret: string, displayName: string, credential: string, requestId: string) =>
      fetch(`${base}/v1/invitations/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, displayName, credential, requestId }) });
    const editorInvite = await invite('editor');
    expect(editorInvite.status).toBe(201);
    const editorSecret = (await editorInvite.json() as { secret: string }).secret;
    const editorCredential = randomBytes(32).toString('base64url');
    const editorRequestId = randomUUID();
    const editorResponse = await accept(editorSecret, 'Colleague', editorCredential, editorRequestId);
    expect(editorResponse.status).toBe(201);
    const editor = { member: (await editorResponse.json() as { member: TeamMember }).member, credential: editorCredential };
    const inviteRetry = await accept(editorSecret, 'Colleague', editorCredential, editorRequestId);
    expect(inviteRetry.status).toBe(201);
    expect((await inviteRetry.json() as { member: TeamMember }).member.id).toBe(editor.member.id);
    expect((await accept(editorSecret, 'Duplicate', randomBytes(32).toString('base64url'), randomUUID())).status).toBe(400);
    const viewerInvite = await invite('viewer');
    const viewerCredential = randomBytes(32).toString('base64url');
    const viewerResponse = await accept((await viewerInvite.json() as { secret: string }).secret, 'Observer',
      viewerCredential, randomUUID());
    const viewer = { member: (await viewerResponse.json() as { member: TeamMember }).member, credential: viewerCredential };
    expect((await invite('editor', viewer.credential)).status).toBe(403);
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
    expect((await (await getWorkspace(owner.credential)).json()).projects).toEqual([{ id: project.id, name: project.name, canEditDraft: true, canManageTask: true }]);
    expect((await (await getWorkspace(editor.credential)).json()).projects).toEqual([{ id: project.id, name: project.name, canEditDraft: true, canManageTask: false }]);
    const secondPath = join(root, 'other');
    mkdirSync(secondPath);
    const secondProject = store.createProject({ name: 'Private subproject', path: secondPath });
    addTeamProject(store.db, owner.credential, secondProject.id);
    setTeamProjectAccess(store.db, owner.credential, secondProject.id, editor.member.id, 'none');
    expect((await (await getWorkspace(owner.credential)).json()).projects).toHaveLength(2);
    expect((await (await getWorkspace(editor.credential)).json()).projects).toEqual([{ id: project.id, name: project.name, canEditDraft: true, canManageTask: false }]);
    expect((await firstBoard.json()).cards[0]).toMatchObject({ id: card.id, revision: 0 });
    expect((await secondBoard.json()).cards[0]).toMatchObject({ id: card.id, revision: 0 });
    expect((await getBoard(editor.credential, randomUUID())).status).toBe(403);
    expect((await getBoard('wrong')).status).toBe(401);
    expect((await fetch(`${base}/v1/workspace`, { headers: { Authorization: `Bearer ${owner.credential}`,
      Origin: 'https://untrusted.example' } })).status).toBe(403);
    expect((await fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/priority`, { method: 'POST',
      headers: { Authorization: `Bearer ${owner.credential}`, 'Content-Type': 'application/json' },
      body: '{invalid' })).status).toBe(400);
    const ownerMutation = randomUUID();
    expect((await setPriority(owner.credential, 'high', 0, ownerMutation)).status).toBe(200);
    expect((await (await getBoard(editor.credential)).json()).cards[0]).toMatchObject({ priority: 'high', revision: 1 });
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
    const recoveredInvite = await accept(editorSecret, 'Colleague', editorCredential, editorRequestId);
    expect(recoveredInvite.status).toBe(201);
    expect((await recoveredInvite.json() as { member: TeamMember }).member.id).toBe(editor.member.id);
    expect((await getBoard(editor.credential)).status).toBe(200);
    expect((await setPriority(editor.credential, 'urgent', 1, randomUUID())).status).toBe(200);
    expect(store.card(card.id).priority).toBe('urgent');
    const nextColumn = store.snapshot(project.id).columns[1]!;
    const move = (key: string, columnId: string, expectedRevision: number, mutationId: string) =>
      fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/column`, { method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId, expectedRevision, mutationId }) });
    expect((await move(viewer.credential, nextColumn.id, 2, randomUUID())).status).toBe(403);
    expect((await move(editor.credential, nextColumn.id, 1, randomUUID())).status).toBe(409);
    expect((await move(owner.credential, store.snapshot(secondProject.id).columns[0]!.id, 2, randomUUID())).status).toBe(400);
    const moveId = randomUUID();
    expect((await move(editor.credential, nextColumn.id, 2, moveId)).status).toBe(200);
    expect((await (await getBoard(owner.credential)).json()).cards[0]).toMatchObject({ columnId: nextColumn.id, revision: 3 });
    expect((await (await move(editor.credential, nextColumn.id, 2, moveId)).json()).repeated).toBe(true);
    expect((await move(editor.credential, column.id, 3, moveId)).status).toBe(400);
    expect(store.card(card.id).columnId).toBe(nextColumn.id);
    expect((store.db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count).toBe(0);
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null,
      activeWorkflowId: null, pauseReason: null });
    expect((await move(owner.credential, column.id, 3, randomUUID())).status).toBe(423);
    store.saveProjectQueue({ projectId: project.id, state: 'off', templateWorkflowId: null,
      activeWorkflowId: null, pauseReason: null });
    expect(store.card(card.id).columnId).toBe(nextColumn.id);
    const revoke = (key: string) => fetch(`${base}/v1/workspace/members/${editor.member.id}/revoke`,
      { method: 'POST', headers: { Authorization: `Bearer ${key}` } });
    expect((await revoke(viewer.credential)).status).toBe(403);
    expect((await revoke(owner.credential)).status).toBe(200);
    expect((await getBoard(editor.credential)).status).toBe(401);
    expect((await setPriority(editor.credential, 'low', 3, randomUUID())).status).toBe(401);
    expect((await move(editor.credential, column.id, 3, randomUUID())).status).toBe(401);
  } finally {
    await coordinator?.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('dispatches an authorized auto-start move once and never repeats it after a lost reply', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-auto-start-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  let coordinator: TeamCoordinatorHttp | null = null;
  try {
    const project = store.createProject({ name: 'Synthetic project', path: root });
    const source = store.snapshot(project.id).columns[0]!;
    const card = store.createCard({ projectId: project.id, columnId: source.id, title: 'Agent task' });
    const failedCard = store.createCard({ projectId: project.id, columnId: source.id, title: 'Failed agent task' });
    const agent = store.saveAgent({ name: 'Synthetic agent', kind: 'custom', command: process.execPath,
      args: ['-e', 'console.log("TEAM_AGENT")'], model: null, enabled: true });
    const target = store.createColumn({ projectId: project.id, name: 'Team run', agentId: agent.id, autoStart: true });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Sample team', projectId: project.id, ownerName: 'Owner' });
    const editor = acceptTeamMemberInvite(store.db,
      createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'editor').secret, 'Editor');
    setTeamCapabilityGrant(store.db, owner.credential, project.id, editor.member.id, 'manage_task', true);
    const sessionId = randomUUID();
    let starts = 0;
    coordinator = new TeamCoordinatorHttp(store, (cardId, agentId) => {
      expect(agentId).toBe(agent.id); starts += 1;
      if (cardId === failedCard.id) throw new Error('Synthetic launch failure');
      return { id: sessionId };
    });
    const base = await coordinator.start();
    const mutationId = randomUUID();
    const move = (credential: string) => fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/column`, {
      method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: target.id, expectedRevision: 0, mutationId }),
    });
    expect((await move(editor.credential)).status).toBe(403);
    expect(store.card(card.id).columnId).toBe(source.id);
    setTeamCapabilityGrant(store.db, owner.credential, project.id, editor.member.id, 'start_agent', true);
    const first = await move(editor.credential);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ repeated: false,
      agentLaunch: { state: 'started', sessionId, agentId: agent.id } });
    const repeated = await move(editor.credential);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ repeated: true,
      agentLaunch: { state: 'started', sessionId } });
    expect(starts).toBe(1);
    const failedMutation = randomUUID();
    const failedMove = () => fetch(`${base}/v1/projects/${project.id}/cards/${failedCard.id}/column`, {
      method: 'POST', headers: { Authorization: `Bearer ${editor.credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: target.id, expectedRevision: 0, mutationId: failedMutation }),
    });
    const failed = await failedMove();
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ repeated: false, agentLaunch: { state: 'failed', sessionId: null } });
    expect(store.card(failedCard.id).columnId).toBe(target.id);
    const failedRetry = await failedMove();
    expect(await failedRetry.json()).toMatchObject({ repeated: true, agentLaunch: { state: 'failed' } });
    expect(starts).toBe(2);
  } finally { await coordinator?.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
