import { describe, expect, it } from 'vitest';
import { packAccountCookies, unpackAccountCookies } from '../../src/main/dev-account-login';

const origin = 'http://127.0.0.1:55101';

describe('protected development login cookie snapshot', () => {
  it('keeps only exact-host cookies and restores them for another port of the same host', () => {
    const packed = packAccountCookies('account-1', origin, [
      { name: 'auth', value: 'synthetic-secret', domain: '127.0.0.1', hostOnly: true, path: '/api', httpOnly: true, sameSite: 'strict' },
      { name: 'unrelated', value: 'not-saved', domain: 'elsewhere.example' },
    ]);
    expect(JSON.parse(packed).cookies).toHaveLength(1);
    expect(unpackAccountCookies(packed, 'account-1', 'http://127.0.0.1:55102')).toEqual([
      { url: 'http://127.0.0.1:55102/api', name: 'auth', value: 'synthetic-secret', path: '/api', secure: false,
        httpOnly: true, sameSite: 'strict' },
    ]);
    expect(() => unpackAccountCookies(packed, 'account-2', origin)).toThrow('does not match');
    expect(() => unpackAccountCookies(packed, 'account-1', 'http://localhost:55101')).toThrow('does not match');
  });

  it('rejects missing, oversized, expired and malformed cookies', () => {
    expect(() => packAccountCookies('a', origin, [])).toThrow('No bounded');
    expect(() => packAccountCookies('a', origin, [{ name: 'bad\nname', value: 'secret' }])).toThrow('invalid');
    expect(() => packAccountCookies('a', origin, [{ name: 'auth', value: 'x'.repeat(5000) }])).toThrow('invalid');
    const packed = packAccountCookies('a', origin, [{ name: 'auth', value: 'secret', expirationDate: Date.now() / 1000 + 1 }]);
    const expired = JSON.parse(packed); expired.cookies[0].expirationDate = 1;
    expect(unpackAccountCookies(JSON.stringify(expired), 'a', origin)).toEqual([]);
  });
});
