import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkedCoordinatorUrl } from './team-connection-store';

interface Encryptor {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export interface PendingTeamJoin {
  coordinatorUrl: string;
  inviteSecret: string;
  displayName: string;
  credential: string;
  requestId: string;
}

const SECRET = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function checked(value: unknown): PendingTeamJoin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved team join is invalid.');
  const row = value as Partial<PendingTeamJoin>;
  if (typeof row.coordinatorUrl !== 'string' || typeof row.inviteSecret !== 'string' || !SECRET.test(row.inviteSecret) ||
    typeof row.displayName !== 'string' || !row.displayName.trim() || row.displayName.length > 80 ||
    /[\x00-\x1f\x7f]/.test(row.displayName) || typeof row.credential !== 'string' || !SECRET.test(row.credential) ||
    typeof row.requestId !== 'string' || !UUID.test(row.requestId)) throw new Error('Saved team join is invalid.');
  return { coordinatorUrl: checkedCoordinatorUrl(row.coordinatorUrl), inviteSecret: row.inviteSecret,
    displayName: row.displayName.trim(), credential: row.credential, requestId: row.requestId };
}

/** A pending join is sealed before the network request, so it can be retried after a crash. */
export class TeamJoinAttemptStore {
  private readonly file: string;

  constructor(userDataDirectory: string, private readonly secure: Encryptor) {
    this.file = join(userDataDirectory, 'team-join-pending.bin');
  }

  async prepare(input: { coordinatorUrl: string; inviteSecret: string; displayName: string }): Promise<PendingTeamJoin> {
    if (await this.load()) throw new Error('Finish or cancel the pending team invitation first.');
    const value = checked({ ...input, credential: randomBytes(32).toString('base64url'), requestId: randomUUID() });
    await this.write(value);
    return value;
  }

  async load(): Promise<PendingTeamJoin | null> {
    let encrypted: Buffer;
    try { encrypted = await readFile(this.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('Pending team invitation could not be read.');
    }
    if (!await this.secure.isAsyncEncryptionAvailable()) throw new Error('Protected team credential storage is unavailable.');
    try {
      const decrypted = await this.secure.decryptStringAsync(encrypted);
      const value = checked(JSON.parse(decrypted.result) as unknown);
      if (decrypted.shouldReEncrypt) await this.write(value);
      return value;
    } catch { throw new Error('Pending team invitation could not be decrypted.'); }
  }

  async clear(requestId: string): Promise<void> {
    const pending = await this.load();
    if (pending && pending.requestId !== requestId) throw new Error('Another team invitation is pending.');
    await rm(this.file, { force: true });
  }

  private async write(value: PendingTeamJoin): Promise<void> {
    if (!await this.secure.isAsyncEncryptionAvailable()) throw new Error('Protected team credential storage is unavailable.');
    const encrypted = await this.secure.encryptStringAsync(JSON.stringify(value));
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
    } finally { await rm(temporary, { force: true }); }
  }
}
