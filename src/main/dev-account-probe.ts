import type { DevAccount, DevAccountProbe, DevAccountProbeState } from '../shared/dev-account';

const MAX_IDENTITY_BYTES = 4096;

async function identityBody(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IDENTITY_BYTES) throw new Error('Identity response is too large.');
  if (!response.body) throw new Error('Identity response is empty.');
  const reader = response.body.getReader();
  let bytes = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_IDENTITY_BYTES) { await reader.cancel(); throw new Error('Identity response is too large.'); }
    parts.push(part.value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) { merged.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged)) as unknown;
}

/** The target app must return {subject, role} from an authenticated GET endpoint. */
export async function probeDevIdentity(input: {
  account: DevAccount; cardId: string; origin: string;
  request: (url: string, init: RequestInit) => Promise<Response>;
  stillAllowed: () => boolean;
}): Promise<DevAccountProbe> {
  const { account, cardId, origin } = input;
  const checkedAt = new Date().toISOString();
  const result = (state: DevAccountProbeState, detail: string): DevAccountProbe => ({
    accountId: account.id, cardId, origin, state, detail, checkedAt,
  });
  if (!input.stillAllowed()) return result('access-denied', 'Card assignment or development preview changed.');
  const url = new URL(account.probePath, `${origin}/`);
  if (url.origin !== origin) return result('access-denied', 'Identity endpoint left the development preview.');
  let response: Response;
  try {
    response = await input.request(url.href, { method: 'GET', credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  } catch { return result('unavailable', 'Identity endpoint could not be reached.'); }
  if (!input.stillAllowed()) return result('access-denied', 'Card assignment or development preview changed.');
  if (response.status === 401 || response.status === 302 || response.status === 303) return result('login-required', 'The development app requires a new login.');
  if (response.status === 403) return result('access-denied', 'The development app denied this account.');
  if (response.status !== 200) return result('unavailable', `Identity endpoint returned HTTP ${response.status}.`);
  try {
    const body = await identityBody(response);
    if (!input.stillAllowed()) return result('access-denied', 'Card assignment or development preview changed.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return result('wrong-account', 'Identity endpoint did not return an account.');
    const identity = body as Record<string, unknown>;
    if (identity.subject !== account.subject || identity.role !== account.role) return result('wrong-account', 'Logged-in subject or role differs from the assigned account.');
    return result('verified', 'The assigned subject and role were observed in this isolated browser session.');
  } catch { return result('unavailable', 'Identity endpoint returned invalid or oversized JSON.'); }
}
