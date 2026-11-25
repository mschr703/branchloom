// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { BrowserView } from '../../src/renderer/components/BrowserView';
import type { ProjectSnapshot } from '../../src/shared/types';

it('lets a recorded click supply the expected element without retyping its ID', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousObserver = globalThis.ResizeObserver;
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as typeof ResizeObserver;
  const snapshot = {
    project: { id: 'project-1', name: 'Synthetic', path: 'synthetic', createdAt: '' },
    columns: [], cards: [{ id: 'card-1', projectId: 'project-1', columnId: 'todo', title: 'Test card', position: 0, archivedAt: null }],
    agents: [], sessions: [], workflows: [], notes: [],
    queue: { projectId: 'project-1', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
  } as ProjectSnapshot;
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    onBrowserState: () => () => undefined,
    browserState: async () => ({ tabs: [], activeTabId: null, url: 'http://127.0.0.1:4020/', title: '', loading: false, canGoBack: false, canGoForward: false, error: null, diagnostics: [] }),
    browserSetBounds: async () => undefined, browserSetVisible: async () => undefined,
    discardBugCapture: async () => undefined, startBugCapture: async () => undefined,
    stopBugCapture: vi.fn(async () => ({ token: 'draft-1', url: 'http://127.0.0.1:4020/', width: 800, height: 600,
      diagnostics: [], actions: [{ kind: 'click', target: { kind: 'id', value: 'menu' } }] })),
  } });
  const button = (label: string) => [...mount.querySelectorAll('button')].find((item) => item.textContent === label)!;
  try {
    await act(async () => { root.render(<BrowserView active snapshot={snapshot} />); });
    await act(async () => { button('Aufnahme starten').click(); });
    expect(mount.textContent).not.toContain('Eingaben, Seitentext und Cookies');
    await act(async () => { button('Aufnahme stoppen').click(); });
    await act(async () => { button('Als Prüfziel nutzen').click(); });
    const fields = [...mount.querySelectorAll('label')];
    expect((fields.find((item) => item.textContent?.includes('Element'))?.querySelector('select') as HTMLSelectElement).value).toBe('id');
    expect((fields.find((item) => item.textContent?.includes('Bezeichner'))?.querySelector('input') as HTMLInputElement).value).toBe('menu');
  } finally {
    await act(async () => { root.unmount(); });
    mount.remove();
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    globalThis.ResizeObserver = previousObserver;
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
