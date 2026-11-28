import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { TeamConnectionStore } from '../../src/main/team-connection-store';
import { TeamJoinAttemptStore } from '../../src/main/team-join-attempt';
import { TeamLocalService } from '../../src/main/team-local-service';
import { TeamCoordinatorHttp, checkedTeamCoordinatorBindHost } from '../../src/main/team-coordinator-http';
import { TeamRemoteClient } from '../../src/main/team-remote-client';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'branchloom-tailnet-')); roots.push(root); return root; };
const secure = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`sealed:${value}`),
  decryptStringAsync: async (value: Buffer) => ({ result: value.toString().slice(7), shouldReEncrypt: false }),
};

it('keeps loopback active while an explicitly enabled peer listener starts and stops', async () => {
  const root = fixture();
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const originalStart = TeamCoordinatorHttp.prototype.start;
  vi.spyOn(TeamCoordinatorHttp.prototype, 'start').mockImplementation(function (preferredPort = 0, address = '127.0.0.1') {
    return address === '127.0.0.2' ? Promise.resolve(`http://${address}:${preferredPort}`)
      : originalStart.call(this, preferredPort, address);
  });
  const host = new TeamLocalService(store, new TeamConnectionStore(root, secure), async () => '127.0.0.2');
  try {
    const project = store.createProject({ name: 'Synthetic', path: root });
    const workspace = await host.create({ projectId: project.id, workspaceName: 'Synthetic team', ownerName: 'Owner' });
    expect(await host.tailnetStatus(project.id)).toEqual({ enabled: false, coordinatorUrl: null });
    await expect(host.invite(project.id, 'editor', 'tailnet')).rejects.toThrow('Enable Tailscale');
    const enabled = await host.enableTailnet(project.id);
    expect(enabled).toMatchObject({ enabled: true, coordinatorUrl: `http://127.0.0.2:${new URL(workspace.coordinatorUrl).port}` });
    const localInvite = await host.invite(project.id, 'viewer');
    const peerInvite = await host.invite(project.id, 'editor', 'tailnet');
    expect(localInvite.coordinatorUrl).toBe(workspace.coordinatorUrl);
    expect(peerInvite.coordinatorUrl).toBe(enabled.coordinatorUrl);
    expect((await fetch(`${workspace.coordinatorUrl}/v1/workspace`)).status).toBe(401);
    expect(await host.disableTailnet(project.id)).toEqual({ enabled: false, coordinatorUrl: null });
    expect((await fetch(`${workspace.coordinatorUrl}/v1/workspace`)).status).toBe(401);
  } finally { await host.close(); store.close(); }
});

it('does not send an invitation secret when the guest tailnet is disconnected', async () => {
  const root = fixture();
  const request = vi.fn(async () => new Response('{}', { status: 503 }));
  const guest = new TeamRemoteClient(new TeamConnectionStore(root, secure), new TeamJoinAttemptStore(root, secure),
    request as typeof fetch, undefined, async () => { throw new Error('Tailnet disconnected'); });
  await expect(guest.beginJoin({ coordinatorUrl: 'http://100.101.102.103:4567',
    inviteSecret: randomBytes(32).toString('base64url'), displayName: 'Guest' })).rejects.toThrow('Coordinator is unavailable');
  expect(request).not.toHaveBeenCalled();
  expect(await guest.pendingJoin()).toEqual({ coordinatorUrl: 'http://100.101.102.103:4567', displayName: 'Guest' });
});

it('rejects arbitrary public, wildcard, and LAN coordinator binds', async () => {
  const root = fixture();
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const coordinator = new TeamCoordinatorHttp(store);
  try {
    expect(checkedTeamCoordinatorBindHost('127.0.0.1', null)).toBe('127.0.0.1');
    expect(checkedTeamCoordinatorBindHost('100.101.102.103', '100.101.102.103')).toBe('100.101.102.103');
    expect(() => checkedTeamCoordinatorBindHost('100.101.102.103', '100.101.102.104')).toThrow('active local Tailscale');
    for (const host of ['0.0.0.0', '127.0.0.2', '192.168.1.2', '8.8.8.8', 'localhost']) {
      await expect(coordinator.start(0, host)).rejects.toThrow('active local Tailscale');
    }
    const url = await coordinator.start();
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${url}/v1/workspace`, { headers: { Host: 'wrong.example' } },
        (response) => { response.resume(); resolve(response.statusCode ?? 0); });
      request.once('error', reject); request.end();
    });
    expect(wrongHost).toBe(421);
  } finally { await coordinator.close(); store.close(); }
});
