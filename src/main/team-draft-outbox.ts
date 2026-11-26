import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Encryptor {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export interface PendingTeamDraftUpdate {
  workspaceId: string;
  projectId: string;
  cardId: string;
  mutationId: string;
  update: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OUTBOX = 100;
const MAX_FILE = 1_500_000;

function checked(value: unknown): PendingTeamDraftUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved team draft update is invalid.');
  const item = value as Partial<PendingTeamDraftUpdate>;
  if (typeof item.workspaceId !== 'string' || !UUID.test(item.workspaceId) ||
    typeof item.projectId !== 'string' || !UUID.test(item.projectId) ||
    typeof item.cardId !== 'string' || !UUID.test(item.cardId) ||
    typeof item.mutationId !== 'string' || !UUID.test(item.mutationId) ||
    typeof item.update !== 'string' || !item.update || item.update.length > 90_000 ||
    Buffer.from(item.update, 'base64').toString('base64') !== item.update) {
    throw new Error('Saved team draft update is invalid.');
  }
  return { workspaceId: item.workspaceId, projectId: item.projectId, cardId: item.cardId,
    mutationId: item.mutationId, update: item.update };
}

/** Persist incremental Yjs updates before the network request; retries keep the mutation ID. */
export class TeamDraftOutboxStore {
  private readonly file: string;
  private mutation: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string, private readonly secure: Encryptor) {
    this.file = join(userDataDirectory, 'team-draft-outbox.bin');
  }

  async list(filter?: { workspaceId: string; projectId: string; cardId: string }): Promise<PendingTeamDraftUpdate[]> {
    const items = await this.read();
    return filter ? items.filter((item) => item.workspaceId === filter.workspaceId &&
      item.projectId === filter.projectId && item.cardId === filter.cardId) : items;
  }

  async enqueue(input: PendingTeamDraftUpdate): Promise<void> {
    await this.mutate(async () => {
      const item = checked(input);
      const items = await this.read();
      const previous = items.find((saved) => saved.mutationId === item.mutationId);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(item)) throw new Error('Team draft mutation ID was already queued for another update.');
        return;
      }
      if (items.length >= MAX_OUTBOX) throw new Error('Team draft outbox is full. Reconnect before editing more.');
      await this.write([...items, item]);
    });
  }

  async acknowledge(mutationId: string): Promise<void> {
    await this.mutate(async () => {
      if (!UUID.test(mutationId)) throw new Error('Invalid team draft mutation ID.');
      const items = await this.read();
      await this.write(items.filter((item) => item.mutationId !== mutationId));
    });
  }

  private mutate(operation: () => Promise<void>): Promise<void> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<PendingTeamDraftUpdate[]> {
    let sealed: Buffer;
    try { sealed = await readFile(this.file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('Saved team draft updates could not be read.');
    }
    if (sealed.length > MAX_FILE * 2 || !await this.secure.isAsyncEncryptionAvailable()) {
      throw new Error('Protected team draft storage is unavailable.');
    }
    try {
      const decrypted = await this.secure.decryptStringAsync(sealed);
      if (decrypted.result.length > MAX_FILE) throw new Error('Saved team draft updates are too large.');
      const value = JSON.parse(decrypted.result) as unknown;
      if (!Array.isArray(value) || value.length > MAX_OUTBOX) throw new Error('Saved team draft updates are invalid.');
      const items = value.map(checked);
      if (new Set(items.map((item) => item.mutationId)).size !== items.length) throw new Error('Duplicate team draft mutation ID.');
      if (decrypted.shouldReEncrypt) await this.write(items);
      return items;
    } catch { throw new Error('Saved team draft updates could not be decrypted.'); }
  }

  private async write(items: PendingTeamDraftUpdate[]): Promise<void> {
    if (!items.length) { await rm(this.file, { force: true }); return; }
    if (!await this.secure.isAsyncEncryptionAvailable()) throw new Error('Protected team draft storage is unavailable.');
    const serialized = JSON.stringify(items);
    if (serialized.length > MAX_FILE) throw new Error('Team draft outbox is full. Reconnect before editing more.');
    const sealed = await this.secure.encryptStringAsync(serialized);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, sealed, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
    } finally { await rm(temporary, { force: true }); }
  }
}
