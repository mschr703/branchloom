import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { link, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

interface LegacyEncryptor {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

const KEY_MARK = Buffer.from('BLTEAMKEY1\0');
const DATA_MARK = Buffer.from('BLTEAMDATA1\0');
export type TeamSecretPurpose = 'team-connections' | 'team-join-attempt' | 'team-draft-outbox';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_DATA_BYTES = 4_000_000;
const POWERSHELL_TIMEOUT_MS = 10_000;
const ENTROPY = 'Branchloom team secret master key v1';

const windowsProtectionScript = (mode: 'protect' | 'unprotect') => [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$line = [Console]::In.ReadLine()',
  "if ($null -eq $line -or $line.Length -gt 4096) { throw 'Invalid input' }",
  '$bytes = [Convert]::FromBase64String($line)',
  `$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')`,
  `$sealed = [System.Security.Cryptography.ProtectedData]::${mode === 'protect' ? 'Protect' : 'Unprotect'}($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
  '[Console]::Out.Write([Convert]::ToBase64String($sealed))',
].join('; ');

/** Only a random master key crosses this pipe. Team credentials never enter PowerShell. */
async function windowsProtect(mode: 'protect' | 'unprotect', input: Buffer): Promise<Buffer> {
  if (input.length > 2048) throw new Error('Protected team key is invalid.');
  const script = Buffer.from(windowsProtectionScript(mode), 'utf16le').toString('base64');
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let overflow = false;
    let settled = false;
    const finish = (error: Error | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(value!);
    };
    const timeout = setTimeout(() => { child.kill(); finish(new Error('Windows team key protection timed out.')); },
      POWERSHELL_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 4096) { overflow = true; child.kill(); }
    });
    // Drain stderr without reflecting process output (which must never expose sensitive input).
    child.stderr.resume();
    child.stdin.on('error', () => undefined);
    child.once('error', () => finish(new Error('Windows team key protection could not start.')));
    child.once('close', (code) => {
      if (overflow || code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) {
        finish(new Error('Windows team key protection failed.'));
        return;
      }
      finish(null, Buffer.from(output, 'base64'));
    });
    child.stdin.end(input.toString('base64') + '\n');
  });
}

/**
 * Windows safeStorage keeps its first key in Chromium's Local State, which may
 * not be written before a crash. This team-only adapter persists a DPAPI-sealed
 * random key first, then uses authenticated encryption for the three team files.
 * Old Electron safeStorage ciphertext remains readable and is migrated on read.
 */
export class TeamSecretStorage {
  private readonly keyFile: string;
  private keyPromise: Promise<Buffer> | null = null;
  private readonly aad: Buffer;

  constructor(userDataDirectory: string, private readonly legacy: LegacyEncryptor, purpose: TeamSecretPurpose) {
    this.keyFile = join(userDataDirectory, 'team-secret-key.bin');
    this.aad = Buffer.from(`Branchloom ${purpose} data v1`);
  }

  async isAsyncEncryptionAvailable(): Promise<boolean> {
    if (process.platform !== 'win32') return this.legacy.isAsyncEncryptionAvailable();
    try { await this.key(); return true; } catch { return false; }
  }

  async encryptStringAsync(value: string): Promise<Buffer> {
    if (process.platform !== 'win32') return this.legacy.encryptStringAsync(value);
    const plain = Buffer.from(value, 'utf8');
    if (plain.length > MAX_DATA_BYTES) throw new Error('Team secret data is too large.');
    const key = await this.key();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(this.aad);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([DATA_MARK, iv, cipher.getAuthTag(), encrypted]);
  }

  async decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
    if (process.platform !== 'win32') return this.legacy.decryptStringAsync(value);
    if (!value.subarray(0, DATA_MARK.length).equals(DATA_MARK)) {
      const old = await this.legacy.decryptStringAsync(value);
      return { result: old.result, shouldReEncrypt: true };
    }
    if (value.length < DATA_MARK.length + IV_BYTES + TAG_BYTES || value.length > MAX_DATA_BYTES + 1024) {
      throw new Error('Protected team data is invalid.');
    }
    const start = DATA_MARK.length;
    const decipher = createDecipheriv('aes-256-gcm', await this.key(), value.subarray(start, start + IV_BYTES));
    decipher.setAAD(this.aad);
    decipher.setAuthTag(value.subarray(start + IV_BYTES, start + IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([decipher.update(value.subarray(start + IV_BYTES + TAG_BYTES)), decipher.final()]);
    return { result: plain.toString('utf8'), shouldReEncrypt: false };
  }

  private key(): Promise<Buffer> {
    if (!this.keyPromise) this.keyPromise = this.readOrCreateKey().catch((error: unknown) => {
      this.keyPromise = null;
      throw error;
    });
    return this.keyPromise;
  }

  private async readOrCreateKey(): Promise<Buffer> {
    let sealed: Buffer;
    try { sealed = await readFile(this.keyFile); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Protected team key could not be read.');
      const key = randomBytes(KEY_BYTES);
      const protectedKey = await windowsProtect('protect', key);
      sealed = Buffer.concat([KEY_MARK, protectedKey]);
      const temporary = `${this.keyFile}.${randomBytes(12).toString('hex')}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(sealed); await handle.sync(); }
        finally { await handle.close(); }
        try {
          // An exclusive hard link publishes already-synced bytes without
          // replacing another process's key during concurrent first use.
          await link(temporary, this.keyFile);
        } catch (linkError) {
          if ((linkError as NodeJS.ErrnoException).code !== 'EEXIST') throw linkError;
          sealed = await readFile(this.keyFile);
          if (sealed.length <= KEY_MARK.length || sealed.length > 4096 ||
            !sealed.subarray(0, KEY_MARK.length).equals(KEY_MARK)) throw new Error('Protected team key is invalid.');
          const winningKey = await windowsProtect('unprotect', sealed.subarray(KEY_MARK.length));
          if (winningKey.length !== KEY_BYTES) throw new Error('Protected team key is invalid.');
          return winningKey;
        }
      } finally { await rm(temporary, { force: true }); }
      return key;
    }
    if (sealed.length <= KEY_MARK.length || sealed.length > 4096 || !sealed.subarray(0, KEY_MARK.length).equals(KEY_MARK)) {
      throw new Error('Protected team key is invalid.');
    }
    const key = await windowsProtect('unprotect', sealed.subarray(KEY_MARK.length));
    if (key.length !== KEY_BYTES) throw new Error('Protected team key is invalid.');
    return key;
  }
}
