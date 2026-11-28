import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TeamRole } from './team-workspace';
import { isTailnetIPv4 } from './team-review-tailnet';

interface Encryptor {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export interface SavedTeamConnection {
  workspaceId: string;
  memberId: string;
  displayName: string;
  role: TeamRole;
  coordinatorUrl: string;
}

export interface TeamConnectionSecret extends SavedTeamConnection { credential: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const ROLES: readonly TeamRole[] = ['owner', 'admin', 'editor', 'developer', 'viewer'];
const MAX_CONNECTIONS = 30;

/** URLs are explicit origins. HTTP is limited to loopback or a verified tailnet route. */
export function checkedCoordinatorUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Coordinator address is invalid.'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || isTailnetIPv4(url.hostname)) && url.port)) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Coordinator address must be HTTPS, local 127.0.0.1, or a Tailscale IPv4 address with a port.');
  }
  return url.origin;
}

/** Distinguish an on-device preview from an HTTPS coordinator without trusting a saved label. */
export function teamCoordinatorTransport(value: string): 'loopback' | 'tailnet' | 'remote-https' {
  const origin = checkedCoordinatorUrl(value);
  if (origin.startsWith('http://127.0.0.1:')) return 'loopback';
  return origin.startsWith('http://') ? 'tailnet' : 'remote-https';
}

function checked(value: unknown): TeamConnectionSecret {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved team connection is invalid.');
  const row = value as Partial<TeamConnectionSecret>;
  if (typeof row.workspaceId !== 'string' || !UUID.test(row.workspaceId) ||
    typeof row.memberId !== 'string' || !UUID.test(row.memberId) ||
    typeof row.credential !== 'string' || !SECRET.test(row.credential) ||
    typeof row.role !== 'string' || !ROLES.includes(row.role) ||
    typeof row.displayName !== 'string' || !row.displayName.trim() || row.displayName.length > 80 ||
    /[\x00-\x1f\x7f]/.test(row.displayName) ||
    typeof row.coordinatorUrl !== 'string') throw new Error('Saved team connection is invalid.');
  return { workspaceId: row.workspaceId, memberId: row.memberId, credential: row.credential,
    role: row.role, displayName: row.displayName, coordinatorUrl: checkedCoordinatorUrl(row.coordinatorUrl) };
}

/** Team credentials remain in Electron userData, encrypted with the OS storage provider. */
export class TeamConnectionStore {
  private readonly file: string;
  private mutation: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string, private readonly secure: Encryptor) {
    this.file = join(userDataDirectory, 'team-connections.bin');
  }

  async list(): Promise<SavedTeamConnection[]> {
    return (await this.read()).map(({ credential: _credential, ...visible }) => visible);
  }

  async get(workspaceId: string): Promise<TeamConnectionSecret | null> {
    return (await this.read()).find((item) => item.workspaceId === workspaceId) ?? null;
  }

  async save(input: TeamConnectionSecret): Promise<SavedTeamConnection> {
    return this.mutate(async () => {
      const value = checked(input);
      const existing = await this.read();
      const entries = [...existing.filter((item) => item.workspaceId !== value.workspaceId), value];
      if (entries.length > MAX_CONNECTIONS) throw new Error('Too many saved team connections.');
      await this.write(entries);
      const { credential: _credential, ...visible } = value;
      return visible;
    });
  }

  async remove(workspaceId: string): Promise<void> {
    await this.mutate(async () => {
      const existing = await this.read();
      await this.write(existing.filter((item) => item.workspaceId !== workspaceId));
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<TeamConnectionSecret[]> {
    let encrypted: Buffer;
    try { encrypted = await readFile(this.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('Saved team connections could not be read.');
    }
    if (!await this.secure.isAsyncEncryptionAvailable()) throw new Error('Protected team credential storage is unavailable.');
    try {
      const decrypted = await this.secure.decryptStringAsync(encrypted);
      const value = JSON.parse(decrypted.result) as unknown;
      if (!Array.isArray(value) || value.length > MAX_CONNECTIONS) throw new Error('Invalid saved team connections.');
      const entries = value.map(checked);
      if (new Set(entries.map((item) => item.workspaceId)).size !== entries.length) throw new Error('Duplicate team connection.');
      if (decrypted.shouldReEncrypt) await this.write(entries);
      return entries;
    } catch { throw new Error('Saved team connections could not be decrypted.'); }
  }

  private async write(entries: TeamConnectionSecret[]): Promise<void> {
    if (!await this.secure.isAsyncEncryptionAvailable()) throw new Error('Protected team credential storage is unavailable.');
    const sealed = await this.secure.encryptStringAsync(JSON.stringify(entries));
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, sealed, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
    } finally { await rm(temporary, { force: true }); }
  }
}
