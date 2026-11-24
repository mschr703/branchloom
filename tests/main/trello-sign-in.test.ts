import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrelloConnection } from '../../src/main/trello-connection';
import { TrelloSignIn, trelloPublicAppKey } from '../../src/main/trello-sign-in';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const key = 'a'.repeat(32);
const token = 'b'.repeat(64);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-trello-signin-'));
  roots.push(root);
  const secure = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value: string) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`),
    decryptStringAsync: async (value: Buffer) => ({ result: Buffer.from(value.toString().slice(7), 'base64').toString(), shouldReEncrypt: false }),
  };
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    expect(new URL(String(input)).origin).toBe('https://api.trello.com');
    expect(init?.method).toBe('GET');
    expect(String((init?.headers as Record<string, string>)?.Authorization)).toContain(`oauth_consumer_key="${key}"`);
    return new Response(JSON.stringify({ id: '1'.repeat(24), fullName: 'Synthetisches Konto' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { root, connection: new TrelloConnection(root, secure, request as typeof fetch) };
}

function returnTarget(authorizeUrl: string): { consent: URL; callback: URL; state: string } {
  const consent = new URL(authorizeUrl);
  const callback = new URL(consent.searchParams.get('return_url')!);
  return { consent, callback, state: callback.searchParams.get('state')! };
}

async function post(callback: URL, state: string, authToken: string, error = '', origin = callback.origin): Promise<Response> {
  return fetch(`${callback.origin}/trello/finish`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, token: authToken, error }),
  });
}

describe('Trello account sign-in', () => {
  it('loads only a build-supplied public app key, never a user token', () => {
    const { root } = fixture();
    expect(trelloPublicAppKey(root, '')).toBeNull();
    writeFileSync(join(root, 'trello-public-app.json'), JSON.stringify({ key }));
    expect(trelloPublicAppKey(root, '')).toBe(key);
    expect(trelloPublicAppKey(root, 'c'.repeat(32))).toBe('c'.repeat(32));
    writeFileSync(join(root, 'trello-public-app.json'), JSON.stringify({ key: 'bad' }));
    expect(trelloPublicAppKey(root, '')).toBeNull();
  });

  it('uses read-only browser consent and accepts one state-bound localhost callback', async () => {
    const { root, connection } = fixture();
    const signIn = new TrelloSignIn(connection, key, async (url) => {
      const { consent, callback, state } = returnTarget(url);
      expect(consent.origin).toBe('https://trello.com');
      expect(consent.pathname).toBe('/1/authorize');
      expect(consent.searchParams.get('scope')).toBe('read');
      expect(consent.searchParams.get('callback_method')).toBe('fragment');
      expect(consent.searchParams.get('response_type')).toBe('token');
      expect(url).not.toContain(token);
      expect(callback.hostname).toBe('127.0.0.1');
      const page = await fetch(callback);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");
      expect(await page.text()).toContain("location.hash.slice(1)");
      expect((await post(callback, state, token, '', 'https://evil.example')).status).toBe(403);
      expect((await post(callback, 'wrong', token)).status).toBe(403);
      expect((await post(callback, state, token)).status).toBe(200);
    }, 0, 2_000);
    expect(signIn.available()).toBe(true);
    await expect(signIn.run()).resolves.toEqual({ connected: true, memberName: 'Synthetisches Konto' });
    expect(await connection.status()).toEqual({ connected: true, memberName: 'Synthetisches Konto' });
    const saved = readFileSync(join(root, 'trello-connection.bin')).toString();
    expect(saved).not.toContain(token);
    expect(saved).not.toContain(key);
  });

  it('keeps a denied consent disconnected', async () => {
    const { root, connection } = fixture();
    const signIn = new TrelloSignIn(connection, key, async (url) => {
      const { callback, state } = returnTarget(url);
      expect((await post(callback, state, '', 'access_denied')).status).toBe(400);
    }, 0, 2_000);
    await expect(signIn.run()).rejects.toThrow('abgelehnt');
    expect(existsSync(join(root, 'trello-connection.bin'))).toBe(false);
  });

  it('cancels a pending sign-in and leaves the fallback available', async () => {
    const { root, connection } = fixture();
    const signIn = new TrelloSignIn(connection, key, async () => { queueMicrotask(() => signIn.cancel()); }, 0, 2_000);
    await expect(signIn.run()).rejects.toThrow('abgebrochen');
    expect(existsSync(join(root, 'trello-connection.bin'))).toBe(false);
    expect(new TrelloSignIn(connection, null, async () => undefined).available()).toBe(false);
    await expect(new TrelloSignIn(connection, null, async () => undefined).run()).rejects.toThrow('keinen Branchloom-Trello-Zugang');
  });

  it('does not report a cancelled sign-in after token validation has begun', async () => {
    let signIn: TrelloSignIn;
    const connection = { connect: async () => { signIn.cancel(); return { connected: true, memberName: 'Synthetisches Konto' }; } } as TrelloConnection;
    signIn = new TrelloSignIn(connection, key, async (url) => {
      const { callback, state } = returnTarget(url);
      expect((await post(callback, state, token)).status).toBe(200);
    }, 0, 2_000);
    await expect(signIn.run()).resolves.toEqual({ connected: true, memberName: 'Synthetisches Konto' });
  });
});
