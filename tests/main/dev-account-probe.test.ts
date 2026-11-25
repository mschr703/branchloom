import { describe, expect, it, vi } from 'vitest';
import type { DevAccount } from '../../src/shared/dev-account';
import { probeDevIdentity } from '../../src/main/dev-account-probe';

const account: DevAccount = { id: 'synthetic-account', projectId: 'project', service: 'Shop', environment: 'local',
  role: 'admin', subject: 'admin-fixture', probePath: '/api/me', createdAt: '2026-01-01T00:00:00.000Z' };
const origin = 'http://127.0.0.1:55123';
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('development account identity probe', () => {
  it('checks exact subject and role using the isolated session request', async () => {
    const request = vi.fn(async () => reply(200, { subject: 'admin-fixture', role: 'admin' }));
    const result = await probeDevIdentity({ account, cardId: 'card', origin, request, stillAllowed: () => true });
    expect(result.state).toBe('verified');
    expect(request).toHaveBeenCalledWith(`${origin}/api/me`, expect.objectContaining({ method: 'GET', credentials: 'include', redirect: 'manual' }));
    expect(JSON.stringify(result)).not.toContain('cookie');
  });

  it('distinguishes missing login, denied access, a wrong account, and an unavailable endpoint', async () => {
    for (const [response, expected] of [
      [reply(401, {}), 'login-required'], [reply(403, {}), 'access-denied'], [reply(302, {}), 'login-required'],
      [reply(200, { subject: 'user-fixture', role: 'user' }), 'wrong-account'], [reply(503, {}), 'unavailable'],
      [new Response('{bad', { status: 200 }), 'unavailable'],
      [new Response('x', { status: 200, headers: { 'content-length': '5000' } }), 'unavailable'],
    ] as const) {
      const result = await probeDevIdentity({ account, cardId: 'card', origin, request: async () => response, stillAllowed: () => true });
      expect(result.state).toBe(expected);
    }
  });

  it('rejects a changed card grant before and after the network request', async () => {
    const request = vi.fn(async () => reply(200, { subject: 'admin-fixture', role: 'admin' }));
    expect((await probeDevIdentity({ account, cardId: 'card', origin, request, stillAllowed: () => false })).state).toBe('access-denied');
    expect(request).not.toHaveBeenCalled();
    let checks = 0;
    const changed = await probeDevIdentity({ account, cardId: 'card', origin, request, stillAllowed: () => ++checks === 1 });
    expect(changed.state).toBe('access-denied');
  });
});
