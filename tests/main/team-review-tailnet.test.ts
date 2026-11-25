import { describe, expect, it } from 'vitest';
import { tailnetIPv4FromStatus } from '../../src/main/team-review-tailnet';

const running = { BackendState: 'Running', Self: { TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1234'] } };

describe('Tailscale review address selection', () => {
  it('uses only the running client address assigned to this computer', () => {
    expect(tailnetIPv4FromStatus(running, ['192.168.1.30', '100.101.102.103'])).toBe('100.101.102.103');
  });

  it('rejects disconnected, foreign, and non-tailnet addresses', () => {
    expect(() => tailnetIPv4FromStatus({ ...running, BackendState: 'Stopped' }, ['100.101.102.103'])).toThrow('Connect Tailscale');
    expect(() => tailnetIPv4FromStatus(running, ['100.101.102.104'])).toThrow('no active Tailscale IPv4');
    expect(() => tailnetIPv4FromStatus({ BackendState: 'Running', Self: { TailscaleIPs: ['192.168.1.30'] } }, ['192.168.1.30'])).toThrow('no active Tailscale IPv4');
    expect(() => tailnetIPv4FromStatus({ BackendState: 'Running', Self: { TailscaleIPs: ['100.128.1.1'] } }, ['100.128.1.1'])).toThrow('no active Tailscale IPv4');
    expect(() => tailnetIPv4FromStatus({ BackendState: 'Running', Self: { TailscaleIPs: ['100.64..1'] } }, ['100.64..1'])).toThrow('no active Tailscale IPv4');
  });
});
