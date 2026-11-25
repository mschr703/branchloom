import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentPreset } from '../../src/shared/types';
import type { UsageSession, UsageSessionPage } from '../../src/shared/usage';
import { formatUsageDuration, projectUsage, usageStart } from '../../src/renderer/usage-data';
import { UsageSourceBreakdown } from '../../src/renderer/components/UsagePanel';

const now = Date.parse('2026-11-24T12:00:00.000Z');
const agent = { id: 'a', name: 'Codex' } as AgentPreset;
function session(id: string, state: UsageSession['state'], start: string, end: string | null, agentId = 'a', exitCode: number | null = null,
  source: Pick<UsageSession, 'origin' | 'workflowId' | 'workflowName'> = { origin: 'direct', workflowId: null, workflowName: null },
  card: Pick<UsageSession, 'cardId' | 'cardTitle'> = { cardId: `card-${id}`, cardTitle: `Task ${id}` }): UsageSession {
  return { id, state, agentId, startedAt: start, endedAt: end, exitCode, ...source, ...card };
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
    expect(usage.origins).toEqual({ direct: 3, workflow: 0, queue: 0, unknown: 0 });
    expect(projectUsage(page, [agent], now, 30).runs).toBe(4);
  });

  it('separates queue, workflow, direct and historical unknown runs without guessing tokens', () => {
    const page: UsageSessionPage = { truncated: false, sessions: [
      session('queue', 'exited', '2026-11-24T08:00:00.000Z', '2026-11-24T08:30:00.000Z', 'a', 0,
        { origin: 'queue', workflowId: 'q', workflowName: 'Night queue' }),
      session('workflow', 'failed', '2026-11-24T09:00:00.000Z', '2026-11-24T09:10:00.000Z', 'a', 1,
        { origin: 'workflow', workflowId: 'w', workflowName: 'Review route' }),
      session('unknown', 'stopped', '2026-11-24T10:00:00.000Z', null, 'a', null,
        { origin: 'unknown', workflowId: null, workflowName: null }),
      session('inconsistent', 'exited', '2026-11-24T11:00:00.000Z', '2026-11-24T11:05:00.000Z', 'a', 0,
        { origin: 'workflow', workflowId: null, workflowName: null }),
    ] };
    const usage = projectUsage(page, [agent], now, 7);
    expect(usage.origins).toEqual({ direct: 0, workflow: 1, queue: 1, unknown: 2 });
    expect(usage.workflows).toEqual([
      { id: 'q', name: 'Night queue', origin: 'queue', runs: 1, durationMs: 30 * 60_000, failed: 0 },
      { id: 'w', name: 'Review route', origin: 'workflow', runs: 1, durationMs: 10 * 60_000, failed: 1 },
    ]);
    expect('tokens' in usage).toBe(false);
    expect('cost' in usage).toBe(false);
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

  it('groups only stored task runs and distinct agents, preserving missing durations', () => {
    const direct = { origin: 'direct', workflowId: null, workflowName: null } as const;
    const card = { cardId: 'card-a', cardTitle: 'Review task' };
    const usage = projectUsage({ truncated: false, sessions: [
      session('first', 'exited', '2026-11-24T10:00:00.000Z', '2026-11-24T10:10:00.000Z', 'a', 0, direct, card),
      session('second', 'failed', '2026-11-24T10:20:00.000Z', null, 'b', 1, direct, card),
      session('third', 'running', '2026-11-24T11:00:00.000Z', null, 'a', null, direct, card),
      session('other', 'exited', '2026-11-24T09:00:00.000Z', '2026-11-24T09:05:00.000Z', 'a'),
    ] }, [agent], now, 7);
    expect(usage.cards).toEqual([
      { id: 'card-a', title: 'Review task', runs: 3, durationMs: 70 * 60_000,
        unknownDurationCount: 1, active: 1, failed: 1, agents: 2 },
      { id: 'card-other', title: 'Task other', runs: 1, durationMs: 5 * 60_000,
        unknownDurationCount: 0, active: 0, failed: 0, agents: 1 },
    ]);
  });

  it('renders explicit source evidence and workflow actions without a token estimate', () => {
    const usage = projectUsage({ truncated: false, sessions: [
      session('queue', 'exited', '2026-11-24T08:00:00.000Z', '2026-11-24T08:30:00.000Z', 'a', 0,
        { origin: 'queue', workflowId: 'queue-id', workflowName: 'Night queue' }),
      session('unknown', 'stopped', '2026-11-24T09:00:00.000Z', null, 'a', null,
        { origin: 'unknown', workflowId: null, workflowName: null }),
    ] }, [agent], now, 7);
    const markup = renderToStaticMarkup(createElement(UsageSourceBreakdown, {
      usage, availableWorkflowIds: new Set(['queue-id']), onOpenWorkflow: () => undefined,
    }));
    expect(markup).toContain('Projektwarteschlange');
    expect(markup).toContain('Historisch ungeklärt');
    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('Night queue');
    expect(markup).not.toContain('Token');
    const removedMarkup = renderToStaticMarkup(createElement(UsageSourceBreakdown, {
      usage, availableWorkflowIds: new Set<string>(), onOpenWorkflow: () => undefined,
    }));
    expect(removedMarkup).toContain('Workflow entfernt');
    expect(removedMarkup).not.toContain('<button');
  });
});
