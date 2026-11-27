// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentPreset } from '../../src/shared/types';
import type { UsageSession } from '../../src/shared/usage';
import { UsageRecentRuns } from '../../src/renderer/components/UsagePanel';

const now = Date.parse('2026-11-24T12:00:00.000Z');
const sessions: UsageSession[] = [
  { id: 'run-a', cardId: 'card-a', cardTitle: 'Review login', agentId: 'codex', state: 'exited',
    startedAt: '2026-11-24T10:00:00.000Z', endedAt: '2026-11-24T10:03:00.000Z', exitCode: 0,
    origin: 'workflow', workflowId: null, workflowName: null },
  { id: 'run-b', cardId: 'removed', cardTitle: 'Removed task', agentId: 'missing', state: 'stopped',
    startedAt: '2026-11-24T09:00:00.000Z', endedAt: null, exitCode: null,
    origin: 'unknown', workflowId: null, workflowName: null },
];

afterEach(() => { document.body.replaceChildren(); });

describe('recent usage rows', () => {
  it('shows observed source, outcome and unknown duration, linking only to an existing card', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const openCard = vi.fn();
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(<UsageRecentRuns sessions={sessions} agents={[{ id: 'codex', name: 'Codex' } as AgentPreset]}
        availableCardIds={new Set(['card-a'])} now={now} onOpenCard={openCard} />); });
      expect(host.textContent).toContain('Review login');
      expect(host.textContent).toContain('Erfolgreich beendet');
      expect(host.textContent).toContain('Startweg ungeklärt');
      expect(host.textContent).toContain('Zeit unbekannt');
      expect(host.textContent).toContain('Entfernter Agent');
      expect(host.querySelectorAll('.usage-recent-row')).toHaveLength(2);
      expect(host.querySelectorAll('button.usage-recent-row')).toHaveLength(1);
      await act(async () => { host.querySelector<HTMLButtonElement>('button.usage-recent-row')!.click(); });
      expect(openCard).toHaveBeenCalledOnce();
      expect(openCard).toHaveBeenCalledWith('card-a');
    } finally {
      await act(async () => { root.unmount(); });
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      host.remove();
    }
  });
});
