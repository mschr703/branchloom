import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { networkInterfaces } from 'node:os';

const execFileAsync = promisify(execFile);

function isTailnetIPv4(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}

/** Only accepts an address reported by a running Tailscale client and assigned to this machine. */
export function tailnetIPv4FromStatus(raw: unknown, localAddresses: readonly string[]): string {
  if (!raw || typeof raw !== 'object') throw new Error('Tailscale status is unavailable.');
  const status = raw as { BackendState?: unknown; Self?: { TailscaleIPs?: unknown } };
  if (status.BackendState !== 'Running' || !Array.isArray(status.Self?.TailscaleIPs)) throw new Error('Connect Tailscale before sharing a review.');
  const candidates = status.Self.TailscaleIPs.filter(isTailnetIPv4);
  const address = candidates.find((candidate) => localAddresses.includes(candidate));
  if (!address) throw new Error('This computer has no active Tailscale IPv4 address.');
  return address;
}

export async function activeTailnetIPv4(): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(process.platform === 'win32' ? 'tailscale.exe' : 'tailscale', ['status', '--json'],
      { timeout: 5_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }));
  } catch { throw new Error('Install and connect Tailscale before sharing a review.'); }
  let status: unknown;
  try { status = JSON.parse(stdout) as unknown; }
  catch { throw new Error('Tailscale status is unavailable.'); }
  const localAddresses = Object.values(networkInterfaces()).flatMap((items) => (items ?? [])
    .filter((item) => item.family === 'IPv4').map((item) => item.address));
  return tailnetIPv4FromStatus(status, localAddresses);
}
