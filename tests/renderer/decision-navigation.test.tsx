// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { notifyInboxChanged, useDecisionInboxIndicator } from '../../src/renderer/decision-navigation';
import { WorkspaceNavigation } from '../../src/renderer/components/WorkspaceNavigation';

const originalApi = Object.getOwnPropertyDescriptor(window, 'studio');
const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
afterEach(() => {
  if (originalApi) Object.defineProperty(window, 'studio', originalApi); else Reflect.deleteProperty(window, 'studio');
  if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

function Indicator({ projectId }: { projectId: string }) {
  const value = useDecisionInboxIndicator(projectId);
  return <span>{value ? `${value.projectId}:${value.reviewCount + value.questionCount}:${value.hasMore}` : 'loading'}</span>;
}

function IndicatorNavigation({ projectId, onView }: { projectId: string; onView: (view: string) => void }) {
  const value = useDecisionInboxIndicator(projectId);
  return <WorkspaceNavigation activeView="board" decisionCount={value ? value.reviewCount + value.questionCount : null} decisionHasMore={value?.hasMore} onView={onView} />;
}

it('refreshes the closed-inbox indicator and discards an old project response', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let firstCount = 1;
  let questionCount = 0;
  let holdFirst = false;
  let resolveFirst: ((value: unknown) => void) | undefined;
  let resolveOther: ((value: unknown) => void) | undefined;
  const read = vi.fn().mockImplementation(({ projectId }: { projectId: string }) => projectId === 'other'
    ? new Promise((resolve) => { resolveOther = resolve; })
    : holdFirst ? new Promise((resolve) => { resolveFirst = resolve; })
    : Promise.resolve({ items: Array.from({ length: firstCount }, (_, index) => ({ id: `item-${index}` })), hasMore: false }));
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    reviewInboxItems: read, agentQuestionDecisionCount: vi.fn().mockImplementation(async (projectId: string) => projectId === 'other' ? 0 : questionCount),
  } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Indicator projectId="first" />); });
    expect(host.textContent).toBe('first:1:false');
    firstCount = 2;
    questionCount = 1;
    await act(async () => { notifyInboxChanged(); });
    expect(host.textContent).toBe('first:3:false');
    holdFirst = true;
    await act(async () => { notifyInboxChanged(); });
    await act(async () => { root.render(<Indicator projectId="other" />); });
    expect(host.textContent).toBe('loading');
    await act(async () => { resolveFirst?.({ items: Array.from({ length: 99 }, (_, index) => ({ id: String(index) })), hasMore: false }); });
    expect(host.textContent).toBe('loading');
    await act(async () => { resolveOther?.({ items: [], hasMore: false }); });
    expect(host.textContent).toBe('other:0:false');
    expect(read).toHaveBeenCalledWith({ projectId: 'other' });
  } finally { await act(async () => { root.unmount(); }); host.remove(); }
});

it('rechecks the inbox when feedback arrives during a pending read', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let resolveFirst: ((value: unknown) => void) | undefined;
  const read = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValue({ items: [{ id: 'new-feedback' }], hasMore: false });
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    reviewInboxItems: read, agentQuestionDecisionCount: vi.fn().mockResolvedValue(0),
  } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Indicator projectId="project" />); });
    expect(host.textContent).toBe('loading');
    await act(async () => { notifyInboxChanged(); });
    await act(async () => { resolveFirst?.({ items: [], hasMore: false }); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe('project:1:false');
  } finally { await act(async () => { root.unmount(); }); host.remove(); }
});

it('opens the decision view from a live review count in the sidebar', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    reviewInboxItems: vi.fn().mockResolvedValue({ items: [{ id: 'guest-feedback' }], hasMore: false }),
    agentQuestionDecisionCount: vi.fn().mockResolvedValue(2),
  } });
  const onView = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<IndicatorNavigation projectId="project" onView={onView} />); });
    const button = host.querySelector('button[aria-label="Entscheidungen: 3 offen"]');
    expect(button).not.toBeNull();
    await act(async () => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onView).toHaveBeenCalledWith('decisions');
  } finally { await act(async () => { root.unmount(); }); host.remove(); }
});
