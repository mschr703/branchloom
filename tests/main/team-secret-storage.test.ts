import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamSecretStorage } from '../../src/main/team-secret-storage';
import { TeamConnectionStore } from '../../src/main/team-connection-store';
import { TeamJoinAttemptStore } from '../../src/main/team-join-attempt';
import { TeamDraftOutboxStore } from '../../src/main/team-draft-outbox';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'branchloom-team-secret-test-')); roots.push(root); return root; };
const legacy = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`legacy:${value}`),
  decryptStringAsync: async (value: Buffer) => {
    if (!value.toString().startsWith('legacy:')) throw new Error('Legacy key unavailable.');
    return { result: value.toString().slice(7), shouldReEncrypt: false };
  },
};

describe.skipIf(process.platform !== 'win32')('Windows team secret storage', () => {
  it('persists a DPAPI-protected key before ciphertext and decrypts after process state is lost', async () => {
    const root = fixture();
    const secret = 'synthetic-member-credential';
    const original = new TeamSecretStorage(root, legacy, 'team-connections');
    expect(await original.isAsyncEncryptionAvailable()).toBe(true);
    const keyFile = readFileSync(join(root, 'team-secret-key.bin'));
    expect(keyFile.toString('utf8')).not.toContain(secret);
    const ciphertext = await original.encryptStringAsync(secret);
    expect(ciphertext.toString('utf8')).not.toContain(secret);
    expect(ciphertext.subarray(0, 12).toString('ascii')).toBe('BLTEAMDATA1\0');
    const reopened = new TeamSecretStorage(root, legacy, 'team-connections');
    await expect(reopened.decryptStringAsync(ciphertext)).resolves.toEqual({ result: secret, shouldReEncrypt: false });
  });

  it('separates the three team secret domains and detects tampering', async () => {
    const root = fixture();
    const kinds = ['team-connections', 'team-join-attempt', 'team-draft-outbox'] as const;
    const stores = kinds.map((purpose) => new TeamSecretStorage(root, legacy, purpose));
    const ciphertexts = await Promise.all(stores.map((store, index) => store.encryptStringAsync(`secret-${index}`)));
    for (let index = 0; index < stores.length; index += 1) {
      await expect(stores[index]!.decryptStringAsync(ciphertexts[index]!)).resolves.toEqual({ result: `secret-${index}`, shouldReEncrypt: false });
      await expect(stores[(index + 1) % stores.length]!.decryptStringAsync(ciphertexts[index]!)).rejects.toThrow();
    }
    const tampered = Buffer.from(ciphertexts[0]!);
    tampered[tampered.length - 1] ^= 1;
    await expect(stores[0]!.decryptStringAsync(tampered)).rejects.toThrow();
  });

  it('migrates legacy Electron ciphertext and fails closed when the protected key disappears', async () => {
    const root = fixture();
    const store = new TeamSecretStorage(root, legacy, 'team-connections');
    const oldCiphertext = await legacy.encryptStringAsync('old-secret');
    await expect(store.decryptStringAsync(oldCiphertext)).resolves.toEqual({ result: 'old-secret', shouldReEncrypt: true });
    const migrated = await store.encryptStringAsync('old-secret');
    await expect(new TeamSecretStorage(root, legacy, 'team-connections').decryptStringAsync(migrated))
      .resolves.toEqual({ result: 'old-secret', shouldReEncrypt: false });
    rmSync(join(root, 'team-secret-key.bin'));
    await expect(new TeamSecretStorage(root, legacy, 'team-connections').decryptStringAsync(migrated)).rejects.toThrow();
  });

  it('persists connections, pending joins, and offline drafts through the same protected profile key', async () => {
    const root = fixture();
    const wrap = (purpose: 'team-connections' | 'team-join-attempt' | 'team-draft-outbox') =>
      new TeamSecretStorage(root, legacy, purpose);
    const connection = { workspaceId: randomUUID(), memberId: randomUUID(), displayName: 'Alex',
      role: 'editor' as const, coordinatorUrl: 'http://127.0.0.1:4123', credential: randomBytes(32).toString('base64url') };
    await new TeamConnectionStore(root, wrap('team-connections')).save(connection);
    const pending = await new TeamJoinAttemptStore(root, wrap('team-join-attempt')).prepare({
      coordinatorUrl: 'http://127.0.0.1:4123', inviteSecret: randomBytes(32).toString('base64url'), displayName: 'Sam',
    });
    const draft = { workspaceId: connection.workspaceId, projectId: randomUUID(), cardId: randomUUID(),
      mutationId: randomUUID(), update: Buffer.from('synthetic-yjs-update').toString('base64') };
    await new TeamDraftOutboxStore(root, wrap('team-draft-outbox')).enqueue(draft);
    expect((await new TeamConnectionStore(root, wrap('team-connections')).get(connection.workspaceId))?.credential)
      .toBe(connection.credential);
    expect((await new TeamJoinAttemptStore(root, wrap('team-join-attempt')).load())?.credential).toBe(pending.credential);
    expect(await new TeamDraftOutboxStore(root, wrap('team-draft-outbox')).list()).toEqual([draft]);
    for (const name of ['team-connections.bin', 'team-join-pending.bin', 'team-draft-outbox.bin']) {
      const raw = readFileSync(join(root, name));
      expect(raw.subarray(0, 12).toString('ascii')).toBe('BLTEAMDATA1\0');
      expect(raw.includes(Buffer.from(connection.credential))).toBe(false);
    }
  });
});
