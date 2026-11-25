const MAX_COOKIES = 32;
const MAX_SNAPSHOT_BYTES = 16 * 1024;
const sameSiteValues = new Set(['unspecified', 'no_restriction', 'lax', 'strict']);

interface SavedCookie {
  name: string;
  value: string;
  path: string;
  domain?: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
}

export interface AccountCookie {
  name: string; value: string; domain?: string; hostOnly?: boolean; path?: string;
  secure?: boolean; httpOnly?: boolean; sameSite?: string; expirationDate?: number;
}

function normalizedCookie(cookie: AccountCookie, host: string): SavedCookie {
  if (typeof cookie.name !== 'string' || !cookie.name || cookie.name.length > 256 || /[\0-\x1f\x7f;,\s]/u.test(cookie.name)
    || typeof cookie.value !== 'string' || cookie.value.length > 4096 || /[\0\r\n]/u.test(cookie.value)) throw new Error('Saved login has an invalid cookie.');
  const domain = cookie.domain?.replace(/^\./u, '').toLowerCase();
  if (domain && domain !== host.toLowerCase()) throw new Error('Saved login cookie belongs to another host.');
  const path = cookie.path ?? '/';
  if (!path.startsWith('/') || path.length > 256 || /[\0\r\n]/u.test(path)) throw new Error('Saved login has an invalid cookie path.');
  const sameSite = cookie.sameSite ?? 'unspecified';
  if (!sameSiteValues.has(sameSite)) throw new Error('Saved login has an invalid cookie policy.');
  const result: SavedCookie = { name: cookie.name, value: cookie.value, path, secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly), sameSite: sameSite as SavedCookie['sameSite'] };
  if (domain && !cookie.hostOnly) result.domain = cookie.domain;
  if (cookie.expirationDate !== undefined) {
    if (!Number.isFinite(cookie.expirationDate)) throw new Error('Saved login has an invalid expiration.');
    result.expirationDate = cookie.expirationDate;
  }
  return result;
}

/** Only exact-host cookies from this memory-only account partition are serialized. */
export function packAccountCookies(accountId: string, origin: string, cookies: AccountCookie[]): string {
  const host = new URL(origin).hostname;
  const own = cookies.filter((cookie) => (cookie.domain?.replace(/^\./u, '').toLowerCase() ?? host.toLowerCase()) === host.toLowerCase()
    && (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000));
  if (!own.length || own.length > MAX_COOKIES) throw new Error('No bounded local login cookies are available to save.');
  const packed = JSON.stringify({ version: 1, accountId, host, cookies: own.map((cookie) => normalizedCookie(cookie, host)) });
  if (Buffer.byteLength(packed, 'utf8') > MAX_SNAPSHOT_BYTES) throw new Error('Saved login exceeds the cookie limit.');
  return packed;
}

export function unpackAccountCookies(json: string, accountId: string, origin: string): Array<SavedCookie & { url: string }> {
  if (Buffer.byteLength(json, 'utf8') > MAX_SNAPSHOT_BYTES) throw new Error('Saved login exceeds the cookie limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Saved login is invalid.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved login is invalid.');
  const value = parsed as Record<string, unknown>;
  const host = new URL(origin).hostname;
  if (value.version !== 1 || value.accountId !== accountId || value.host !== host || !Array.isArray(value.cookies)
    || value.cookies.length < 1 || value.cookies.length > MAX_COOKIES) throw new Error('Saved login does not match this account and local host.');
  return value.cookies.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Saved login cookie is invalid.');
    const cookie = entry as AccountCookie;
    const result = normalizedCookie(cookie, host);
    if (result.expirationDate !== undefined && result.expirationDate <= Date.now() / 1000) return null;
    return { ...result, url: `${origin}${result.path}` };
  }).filter((cookie): cookie is SavedCookie & { url: string } => cookie !== null);
}
