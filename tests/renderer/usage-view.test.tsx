import { describe, expect, it } from 'vitest';
import type { AgentPreset } from '../../src/shared/types';
import type { UsageSession, UsageSessionPage } from '../../src/shared/usage';
import { formatUsageDuration, projectUsage, usageStart } from '../../src/renderer/usage-data';

const now = Date.parse('2026-11-24T12:00:00.000Z');
const agent = { id: 'a', name: 'Codex' } as AgentPreset;
function session(id: string, state: UsageSession['state'], start: string, end: string | null, agentId = 'a', exitCode: number | null = null): UsageSession {
  return { id, state, agentId, startedAt: start, endedAt: end, exitCode };
}

describe('local usage aggregation', () => {
  it('counts complete stored runs beyond the snapshot size, with per-agent and day breakdown', () => {
    const page: UsageSessionPage = { truncated: false, sessions: [
      session('finished', 'exited', '2026-11-24T10:00:00.000Z', '2026-11-24T10:30:00.000Z'),
      session('failed', 'failed', '2026-11-23T10:00:00.000Z', '2026-11-23T10:05:00.000Z', 'b', 1),
      session('running', 'running', '2026-11-24T11:00:00.000Z', null),
      session('out of range', 'exited', '2026-11-10T10:00:00.000Z', '2026-11-10T11:00:00.000Z'),
    ] };
    const usage = projectUsage(page, [agent], now, 7);
    expect(usage).toMatchObject({ runs: 3, active: 1, failed: 1, stopped: 0, knownDurationMs: 95 * 60_000, unknownDurationCount: 0 });
    expect(usage.agents).toEqual([
      { id: 'a', name: 'Codex', runs: 2, durationMs: 90 * 60_000, active: 1, failed: 0 },
      { id: 'b', name: 'Entfernter Agent', runs: 1, durationMs: 5 * 60_000, active: 0, failed: 1 },
    ]);
    expect(usage.days.slice(-2).map((day) => day.runs)).toEqual([1, 2]);
    expect(projectUsage(page, [agent], now, 30).runs).toBe(4);
  });

  it('does not invent duration for missing or invalid end times, or model tokens and cost', () => {
    const usage = projectUsage({ truncated: true, sessions: [
      session('missing end', 'stopped', '2026-11-24T10:00:00.000Z', null),
      session('bad end', 'failed', '2026-11-24T10:00:00.000Z', '2026-11-24T09:00:00.000Z'),
      session('nonzero exit', 'exited', '2026-11-24T10:00:00.000Z', '2026-11-24T10:00:30.000Z', 'a', 2),
      session('future', 'running', '2026-11-25T10:00:00.000Z', null),
    ] }, [agent], now, 7);
    expect(usage).toMatchObject({ truncated: true, runs: 3, active: 0, failed: 2, stopped: 1, knownDurationMs: 30_000, unknownDurationCount: 2 });
    expect('tokens' in usage).toBe(false);
    expect('cost' in usage).toBe(false);
    expect(formatUsageDuration(30_000)).toBe('30 s');
    expect(formatUsageDuration(61 * 60_000)).toBe('1 h 1 min');
  });

  it('starts the selected number of complete local calendar days', () => {
    const start = usageStart(now, 7);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    expect(end.toDateString()).toBe(new Date(now).toDateString());
  });
});
