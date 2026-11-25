import { describe, expect, it, vi } from 'vitest';
import type { DevAccount } from '../../src/shared/dev-account';
import { createSeedAccount, readSeedAccount, SeedEndpointError } from '../../src/main/dev-account-seed';

const target: DevAccount = { id: 'target', projectId: 'project', service: 'Shop', environment: 'local',
  role: 'user', subject: 'user-fixture', probePath: '/api/me', createdAt: '2026-01-01T00:00:00.000Z' };
const origin = 'http://127.0.0.1:55101';
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('local seed contract', () => {
  it('reads an exact account and sends a bounded idempotent creation request', async () => {
    const lookup = vi.fn(async () => reply(200, { subject: target.subject, role: target.role, exists: false }));
    expect(await readSeedAccount({ origin, path: '/__branchloom/accounts', target, request: lookup, stillAllowed: () => true })).toBe('missing');
    expect(lookup.mock.calls[0]?.[0]).toContain('subject=user-fixture');
    expect(lookup.mock.calls[0]?.[0]).toContain('role=user');
    const request = vi.fn(async () => reply(201, { subject: target.subject, role: target.role, exists: true, requestId: 'request-1', created: true }));
    await createSeedAccount({ origin, path: '/__branchloom/accounts', target, requestId: 'request-1', request, stillAllowed: () => true });
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'manual' });
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ subject: 'user-fixture', role: 'user', requestId: 'request-1' });
  });

  it('rejects redirects, mismatched roles, oversized bodies and revoked grants', async () => {
    const basic = { origin, path: '/__branchloom/accounts', target, stillAllowed: () => true };
    await expect(readSeedAccount({ ...basic, request: async () => reply(302, {}) })).rejects.toThrow('HTTP 302');
    await expect(readSeedAccount({ ...basic, request: async () => reply(403, {}) })).rejects.toBeInstanceOf(SeedEndpointError);
    await expect(readSeedAccount({ ...basic, request: async () => reply(200, { subject: target.subject, role: 'admin', exists: false }) })).rejects.toThrow('did not match');
    await expect(readSeedAccount({ ...basic, request: async () => new Response('x'.repeat(4097), { status: 200 }) })).rejects.toThrow('too large');
    const request = vi.fn(async () => reply(200, {}));
    await expect(createSeedAccount({ ...basic, requestId: 'request-1', request, stillAllowed: () => false })).rejects.toThrow('changed');
    expect(request).not.toHaveBeenCalled();
    await expect(createSeedAccount({ ...basic, requestId: 'request-1', request })).rejects.toThrow('receipt');
  });
});
