import { describe, expect, it, vi } from 'vitest';
import { openCurrentCardPreview, type CardPreviewBrowser } from '../../src/renderer/card-preview-open';
import type { CardDevEnvironment } from '../../src/shared/dev-environment';

const run: CardDevEnvironment = { id: 'run-1', projectId: 'project', cardId: 'card-1',
  worktreePath: 'synthetic-worktree', branch: 'synthetic-branch', port: 43123, pid: 123,
  url: 'http://127.0.0.1:43123/', state: 'ready', startedAt: '2026-01-01T00:00:00.000Z',
  readyAt: '2026-01-01T00:00:01.000Z', endedAt: null, exitCode: null, output: '', managed: true };

function browser(current: CardDevEnvironment | null) {
  const calls: string[] = [];
  const api = {
    cardDevEnvironment: vi.fn(async (cardId: string) => { calls.push(`read:${cardId}`); return current; }),
    browserNewTab: vi.fn(async () => { calls.push('tab'); return {} as Awaited<ReturnType<CardPreviewBrowser['browserNewTab']>>; }),
    browserNavigate: vi.fn(async (url: string) => { calls.push(`navigate:${url}`); return {} as Awaited<ReturnType<CardPreviewBrowser['browserNavigate']>>; }),
  } satisfies CardPreviewBrowser;
  return { api, calls };
}

describe('opening a card development preview', () => {
  it('rechecks the same managed ready run before opening its current address', async () => {
    const { api, calls } = browser(run);
    expect(await openCurrentCardPreview(api, 'card-1', run)).toEqual(run);
    expect(calls).toEqual(['read:card-1', 'tab', 'navigate:http://127.0.0.1:43123/']);
  });

  it.each([
    ['stopped', { ...run, state: 'stopped' as const }],
    ['old process', { ...run, managed: false }],
    ['replaced run', { ...run, id: 'run-2' }],
    ['another card', { ...run, cardId: 'card-2' }],
    ['missing run', null],
  ])('refuses a %s without creating a browser tab', async (_name, current) => {
    const { api, calls } = browser(current);
    await expect(openCurrentCardPreview(api, 'card-1', run)).rejects.toThrow('nicht mehr bereit');
    expect(calls).toEqual(['read:card-1']);
  });
});
