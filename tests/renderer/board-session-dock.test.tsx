// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { BoardSessionDock, sessionOutputPreview } from '../../src/renderer/components/BoardSessionDock';
import { observedSessionActivity } from '../../src/renderer/activity-transcript';
import { CardPanel } from '../../src/renderer/components/CardPanel';
import type { ProjectSnapshot, Session } from '../../src/shared/types';

const startedAt = '2026-01-01T12:30:00.000Z';
const session: Session = { id: 'run', projectId: 'p', cardId: 'card', agentId: 'agent', state: 'running', startedAt, endedAt: null, exitCode: null, output: '' };
const base = {
  project: { id: 'p', name: 'Sample', path: 'C:\\sample', createdAt: startedAt },
  columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [{ id: 'card', projectId: 'p', columnId: 'todo', title: 'Review invitation flow', description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, createdAt: startedAt, updatedAt: startedAt, archivedAt: null }],
  agents: [{ id: 'agent', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [],
  workflows: [],
  notes: [],
} as ProjectSnapshot;

it('opens a newly active run and keeps the finished session visible', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onOpenSession = vi.fn();
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => { root.render(<BoardSessionDock snapshot={base} onOpenSession={onOpenSession} />); });
    expect(host.querySelector('.board-session-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('Noch keine Agentensitzung');
    await act(async () => { host.querySelector<HTMLButtonElement>('.board-session-toggle')!.click(); });
    expect(host.textContent).toContain('Noch keine Agentensitzung');
    await act(async () => { host.querySelector<HTMLButtonElement>('.board-session-toggle')!.click(); });
    await act(async () => { root.render(<BoardSessionDock snapshot={{ ...base, sessions: [session] }} onOpenSession={onOpenSession} />); });
    expect(host.querySelector('.board-session-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('Review invitation flow');
    expect(host.textContent).toContain('Codex');
    expect(host.querySelector('.board-session-preview')).toBeNull();
    await act(async () => { root.render(<BoardSessionDock snapshot={{ ...base, sessions: [{ ...session, output: '\u001b[32mread\u001b[0m file.ts\nedit filter\ncheck preview\n' }] }} onOpenSession={onOpenSession} />); });
    expect(host.querySelector('.board-session-preview pre')?.textContent).toBe('read file.ts\nedit filter\ncheck preview');
    await act(async () => { host.querySelector<HTMLButtonElement>('.board-session-row')!.click(); });
    expect(onOpenSession).toHaveBeenCalledWith('card', 'run');
    await act(async () => { root.render(<BoardSessionDock snapshot={{ ...base, sessions: [{ ...session, state: 'exited' }] }} onOpenSession={onOpenSession} />); });
    expect(host.textContent).toContain('0 aktiv');
    expect(host.querySelector('.board-session-row')?.textContent).toContain('Beendet');
    expect(host.querySelector('.board-session-row')?.textContent).toContain('Review invitation flow');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});

it('limits the dock preview to the latest three readable lines', () => {
  expect(sessionOutputPreview('old\nsecond\nthird\nfourth\n')).toBe('second\nthird\nfourth');
  expect(sessionOutputPreview('x'.repeat(600))).toHaveLength(480);
});

it('quotes the latest observed output without treating an event payload as progress', () => {
  expect(observedSessionActivity('\u001b[32m> npm test\u001b[0m\r\n')).toBe('> npm test');
  expect(observedSessionActivity('{"type":"item.updated","private":"data"}\n')).toBeNull();
  expect(observedSessionActivity('  \r\n')).toBeNull();
});

it('shows the selected run when a card has multiple saved sessions', () => {
  const historical = { ...session, id: 'older', state: 'exited' as const, startedAt: '2025-12-31T10:00:00.000Z', endedAt: '2025-12-31T10:01:00.000Z', worktreePath: 'C:\\sample\\older-run' };
  const snapshot = { ...base, sessions: [{ ...session, worktreePath: 'C:\\sample\\current-run' }, historical], queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null } } as ProjectSnapshot;
  const html = renderToStaticMarkup(<CardPanel card={snapshot.cards[0]!} snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} onClose={() => undefined} onOpenCard={() => undefined} focusSession focusSessionId="older" />);
  expect(html).toContain('Sitzung auswählen');
  expect(html).toContain('older-run');
  expect(html).not.toContain('current-run');
  const rendered = document.createElement('div');
  rendered.innerHTML = html;
  expect([...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Agent starten'))?.disabled).toBe(true);
  expect(rendered.querySelector('.resume-controls')).toBeNull();
});
