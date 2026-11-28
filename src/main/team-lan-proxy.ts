import { isIP } from 'node:net';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';

let systemTrustEnabled = false;

/** Node fetch otherwise uses bundled roots only; the LAN CA is trusted by Windows. */
export function enableLanSystemTrust(): void {
  if (systemTrustEnabled) return;
  const system = getCACertificates('system');
  if (!system.length) throw new Error('No trusted system certificates are available for the LAN proxy.');
  setDefaultCACertificates([...getCACertificates('default'), ...system]);
  systemTrustEnabled = true;
}

export function isLanHttpsOrigin(value: string): boolean {
  try { checkedLanProxyOrigin(value); return true; }
  catch { return false; }
}

/** A LAN invitation must use a TLS endpoint on an RFC1918 IPv4 address. */
export function checkedLanProxyOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS address for the local network proxy.'); }
  const parts = url.hostname.split('.').map(Number);
  const privateAddress = isIP(url.hostname) === 4 && parts.length === 4 &&
    (parts[0] === 10 || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168));
  if (url.protocol !== 'https:' || !privateAddress || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use HTTPS on a private LAN IPv4 address, without a path or credentials.');
  }
  return url.origin;
}

/** Prove that the trusted TLS endpoint forwards to this running coordinator before issuing an invite. */
export async function verifyLanProxyOrigin(proxy: string, local: string,
  request: typeof fetch = fetch): Promise<string> {
  const origin = checkedLanProxyOrigin(proxy);
  if (request === fetch) enableLanSystemTrust();
  const readMarker = async (base: string): Promise<string> => {
    const response = await request(`${base}/v1/instance`, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('The local network proxy did not reach this coordinator.');
    const body = await response.json() as { instance?: unknown };
    if (typeof body.instance !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(body.instance)) {
      throw new Error('The local network proxy returned an invalid coordinator marker.');
    }
    return body.instance;
  };
  try {
    const expected = await readMarker(local);
    if (await readMarker(origin) !== expected) throw new Error('The local network proxy points to another coordinator.');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The local network proxy')) throw error;
    throw new Error('Could not verify the local HTTPS proxy. Check its certificate, address and connection.');
  }
  return origin;
}
