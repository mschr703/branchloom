import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TeamJoinAttemptStore } from '../../src/main/team-join-attempt';

const secure = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`sealed:${[...value].reverse().join('')}`),
  decryptStringAsync: async (value: Buffer) => {
    if (!value.toString().startsWith('sealed:')) throw new Error('Invalid ciphertext');
    return { result: [...value.toString().slice(7)].reverse().join(''), shouldReEncrypt: false };
  },
};

it('persists the same join credential and mutation ID across a restart for safe retry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-join-'));
  try {
    const inviteSecret = randomBytes(32).toString('base64url');
    const first = new TeamJoinAttemptStore(root, secure);
    const prepared = await first.prepare({ coordinatorUrl: 'https://team.example.com', inviteSecret, displayName: 'Colleague' });
    const stored = readFileSync(join(root, 'team-join-pending.bin'));
    expect(stored.includes(Buffer.from(inviteSecret))).toBe(false);
    expect(stored.includes(Buffer.from(prepared.credential))).toBe(false);
    const resumed = new TeamJoinAttemptStore(root, secure);
    expect(await resumed.load()).toEqual(prepared);
    await expect(resumed.prepare({ coordinatorUrl: 'https://another.example.com', inviteSecret, displayName: 'Other' }))
      .rejects.toThrow('pending');
    await expect(resumed.clear('wrong')).rejects.toThrow('Another');
    await resumed.clear(prepared.requestId);
    expect(await resumed.load()).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
