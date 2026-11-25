import type { DevAccount } from '../shared/dev-account';

const MAX_BODY_BYTES = 4096;

export class SeedEndpointError extends Error {
  constructor(readonly status: number) { super(`Seed endpoint returned HTTP ${status}.`); }
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('Seed response is too large.');
  if (!response.body) throw new Error('Seed response is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('Seed response is too large.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Seed response must be an object.');
  return parsed as Record<string, unknown>;
}

export async function readSeedAccount(input: {
  origin: string; path: string; target: DevAccount;
  request: (url: string, init: RequestInit) => Promise<Response>;
  stillAllowed: () => boolean;
}): Promise<'exists' | 'missing'> {
  if (!input.stillAllowed()) throw new Error('Card grant or preview changed.');
  const url = new URL(input.path, `${input.origin}/`);
  url.searchParams.set('subject', input.target.subject);
  url.searchParams.set('role', input.target.role);
  if (url.origin !== input.origin) throw new Error('Seed endpoint left the preview.');
  const response = await input.request(url.href, { method: 'GET', credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  if (!input.stillAllowed()) throw new Error('Card grant or preview changed.');
  if (response.status !== 200 || response.redirected) throw new SeedEndpointError(response.status);
  const body = await boundedJson(response);
  if (!input.stillAllowed()) throw new Error('Card grant or preview changed.');
  if (body.subject !== input.target.subject || body.role !== input.target.role || typeof body.exists !== 'boolean') {
    throw new Error('Seed lookup did not match the target subject and role.');
  }
  return body.exists ? 'exists' : 'missing';
}

export async function createSeedAccount(input: {
  origin: string; path: string; target: DevAccount; requestId: string;
  request: (url: string, init: RequestInit) => Promise<Response>;
  stillAllowed: () => boolean;
}): Promise<void> {
  if (!input.stillAllowed()) throw new Error('Card grant or preview changed.');
  const url = new URL(input.path, `${input.origin}/`);
  if (url.origin !== input.origin) throw new Error('Seed endpoint left the preview.');
  const response = await input.request(url.href, {
    method: 'POST', credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: input.target.subject, role: input.target.role, requestId: input.requestId }),
  });
  if (!input.stillAllowed()) throw new Error('Card grant or preview changed.');
  if (![200, 201].includes(response.status) || response.redirected) throw new SeedEndpointError(response.status);
  const body = await boundedJson(response);
  if (!input.stillAllowed()) throw new Error('Card grant or preview changed.');
  if (body.subject !== input.target.subject || body.role !== input.target.role || body.exists !== true || body.requestId !== input.requestId || typeof body.created !== 'boolean') {
    throw new Error('Seed creation receipt does not match the requested target.');
  }
}
