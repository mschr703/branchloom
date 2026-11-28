import { expect, it, vi } from 'vitest';
import { checkedLanProxyOrigin, verifyLanProxyOrigin } from '../../src/main/team-lan-proxy';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamConnectionStore } from '../../src/main/team-connection-store';
import { TeamLocalService } from '../../src/main/team-local-service';
import { StudioStore } from '../../src/main/store';

it('accepts only explicit HTTPS endpoints on private LAN IPv4 addresses', () => {
  expect(checkedLanProxyOrigin('https://192.168.1.20:8443')).toBe('https://192.168.1.20:8443');
  expect(checkedLanProxyOrigin('https://10.1.2.3:9443')).toBe('https://10.1.2.3:9443');
  expect(checkedLanProxyOrigin('https://172.31.255.10:8443')).toBe('https://172.31.255.10:8443');
  expect(checkedLanProxyOrigin('https://192.168.1.20')).toBe('https://192.168.1.20');
  for (const value of ['http://192.168.1.20:8443', 'https://8.8.8.8:8443',
    'https://100.73.95.17:8443', 'https://127.0.0.1:8443', 'https://192.168.1.20:8443/path',
    'https://user:pass@192.168.1.20:8443', 'https://172.32.0.1:8443']) {
    expect(() => checkedLanProxyOrigin(value)).toThrow();
  }
});

it('verifies the exact running coordinator through the TLS proxy before sharing a secret', async () => {
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.redirect).toBe('error');
    return Response.json({ instance: url.startsWith('https://192.168.1.20:8443')
      ? '1234567890123456789012' : '1234567890123456789012' });
  });
  await expect(verifyLanProxyOrigin('https://192.168.1.20:8443',
    'http://127.0.0.1:4567', request as typeof fetch)).resolves.toBe('https://192.168.1.20:8443');
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledWith('https://192.168.1.20:8443/v1/instance', expect.any(Object));
});

it('rejects a wrong coordinator, redirects and certificate failures', async () => {
  const wrong = vi.fn(async (url: string) => Response.json({ instance: url.startsWith('https:')
    ? 'AAAAAAAAAAAAAAAAAAAAAA' : '1234567890123456789012' }));
  await expect(verifyLanProxyOrigin('https://192.168.1.20:8443', 'http://127.0.0.1:4567',
    wrong as typeof fetch)).rejects.toThrow('another coordinator');
  const redirect = vi.fn(async (url: string) => url.startsWith('https:')
    ? new Response(null, { status: 302, headers: { Location: 'http://example.com' } })
    : Response.json({ instance: '1234567890123456789012' }));
  await expect(verifyLanProxyOrigin('https://192.168.1.20:8443', 'http://127.0.0.1:4567',
    redirect as typeof fetch)).rejects.toThrow('did not reach');
  const tlsFailure = vi.fn(async (url: string) => {
    if (url.startsWith('https:')) throw new Error('certificate verify failed');
    return Response.json({ instance: '1234567890123456789012' });
  });
  await expect(verifyLanProxyOrigin('https://192.168.1.20:8443', 'http://127.0.0.1:4567',
    tlsFailure as typeof fetch)).rejects.toThrow('certificate');
});

it('issues a LAN invitation only after the proxy points to the running owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-lan-test-'));
  const secure = { isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value: string) => Buffer.from(`sealed:${value}`),
    decryptStringAsync: async (value: Buffer) => ({ result: value.toString().slice(7), shouldReEncrypt: false }) };
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const verify = vi.fn(async (_proxy: string, _local: string) => {
    throw new Error('The local network proxy points to another coordinator.');
  });
  const service = new TeamLocalService(store, new TeamConnectionStore(root, secure), async () => '',
    verify as typeof verifyLanProxyOrigin);
  try {
    const project = store.createProject({ name: 'Synthetic', path: root });
    const workspace = await service.create({ projectId: project.id, workspaceName: 'Team', ownerName: 'Owner' });
    await expect(service.invite(project.id, 'editor', 'lan', 'https://192.168.1.20:8443'))
      .rejects.toThrow('another coordinator');
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM team_member_invites').get()).toEqual({ count: 0 });
    verify.mockImplementation(async () => 'https://192.168.1.20:8443');
    const invite = await service.invite(project.id, 'editor', 'lan', 'https://192.168.1.20:8443');
    expect(verify).toHaveBeenCalledWith('https://192.168.1.20:8443', workspace.coordinatorUrl);
    expect(invite.coordinatorUrl).toBe('https://192.168.1.20:8443');
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM team_member_invites').get()).toEqual({ count: 1 });
  } finally { await service.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
