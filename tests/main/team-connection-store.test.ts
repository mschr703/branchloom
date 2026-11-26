import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { TeamConnectionStore, checkedCoordinatorUrl } from '../../src/main/team-connection-store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'branchloom-team-connection-')); roots.push(root); return root; };
const secure = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`sealed:${[...value].reverse().join('')}`),
  decryptStringAsync: async (value: Buffer) => {
    if (!value.toString().startsWith('sealed:')) throw new Error('Invalid ciphertext');
    return { result: [...value.toString().slice(7)].reverse().join(''), shouldReEncrypt: false };
  },
};

it('saves a team credential encrypted outside the repository and restores it after restart', async () => {
  const root = fixture();
  const input = { workspaceId: randomUUID(), memberId: randomUUID(), displayName: 'Colleague',
    role: 'editor' as const, coordinatorUrl: 'https://team.example.com', credential: randomBytes(32).toString('base64url') };
  const first = new TeamConnectionStore(root, secure);
  expect(await first.save(input)).toEqual({ workspaceId: input.workspaceId, memberId: input.memberId,
    displayName: input.displayName, role: input.role, coordinatorUrl: input.coordinatorUrl });
  const raw = readFileSync(join(root, 'team-connections.bin'));
  expect(raw.includes(Buffer.from(input.credential))).toBe(false);
  expect(raw.includes(Buffer.from(input.displayName))).toBe(false);
  const reopened = new TeamConnectionStore(root, secure);
  expect(await reopened.get(input.workspaceId)).toEqual(input);
  expect(await reopened.list()).toEqual([{ workspaceId: input.workspaceId, memberId: input.memberId,
    displayName: input.displayName, role: input.role, coordinatorUrl: input.coordinatorUrl }]);
  await reopened.remove(input.workspaceId);
  expect(await reopened.list()).toEqual([]);
});

it('rejects unprotected storage, untrusted HTTP origins, and corrupt encrypted data', async () => {
  const root = fixture();
  const input = { workspaceId: randomUUID(), memberId: randomUUID(), displayName: 'Member', role: 'viewer' as const,
    coordinatorUrl: 'http://127.0.0.1:4567', credential: randomBytes(32).toString('base64url') };
  const unavailable = new TeamConnectionStore(root, { ...secure, isAsyncEncryptionAvailable: async () => false });
  await expect(unavailable.save(input)).rejects.toThrow('unavailable');
  expect(checkedCoordinatorUrl('http://127.0.0.1:4567')).toBe('http://127.0.0.1:4567');
  for (const url of ['http://example.com:4567', 'https://team.example.com/path',
    'https://user:pass@team.example.com', 'http://127.0.0.1']) {
    expect(() => checkedCoordinatorUrl(url)).toThrow();
  }
  writeFileSync(join(root, 'team-connections.bin'), 'invalid ciphertext');
  await expect(new TeamConnectionStore(root, secure).list()).rejects.toThrow('could not be decrypted');
});

it('keeps two connections saved at the same time without losing either one', async () => {
  const root = fixture();
  const store = new TeamConnectionStore(root, secure);
  const connection = (displayName: string) => ({ workspaceId: randomUUID(), memberId: randomUUID(), displayName,
    role: 'developer' as const, coordinatorUrl: 'https://team.example.com', credential: randomBytes(32).toString('base64url') });
  const first = connection('First');
  const second = connection('Second');
  await Promise.all([store.save(first), store.save(second)]);
  expect((await store.list()).map((item) => item.workspaceId).sort()).toEqual([first.workspaceId, second.workspaceId].sort());
  expect((await new TeamConnectionStore(root, secure).get(second.workspaceId))?.credential).toBe(second.credential);
});
