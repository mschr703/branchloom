// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { App } from '../../src/renderer/App';

it('shows a clear start action and hides project-only controls until a project exists', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    projects: async () => [],
    projectOrganization: async () => ({ groups: [], assignments: {}, sort: 'name' }),
    onBrowserSearchShortcut: () => () => undefined,
  } });
  try {
    await act(async () => { root.render(<App />); });
    expect(mount.querySelector('.topbar-title h1')?.textContent).toBe('Start');
    expect(mount.querySelector('.empty-intro')?.textContent).toContain('Ideen als Aufgaben zu planen');
    expect(mount.querySelector('.empty-intro button.primary-button')?.textContent).toContain('Codeordner auswählen');
    expect(mount.querySelector('.first-run-import')?.textContent).toContain('Branchloom-Paket importieren');
    expect(mount.querySelector('.side-nav')).toBeNull();
    expect(mount.querySelector('.mobile-workspace')).toBeNull();
    expect(mount.querySelector('.project-switcher-trigger')).toBeNull();
    expect(mount.querySelector('.sidebar-projects')).toBeNull();
    expect(mount.textContent).not.toContain('Projektaktionen');
    expect(mount.querySelector('#project-select')).toHaveProperty('hidden', true);
    expect(mount.querySelector('.search-trigger')).toBeNull();
    expect(mount.querySelector('.project-pause-button')).toBeNull();
    await act(async () => { mount.querySelector<HTMLButtonElement>('.empty-intro button.primary-button')!.click(); });
    expect(mount.querySelector('#new-project-folder')).toBeTruthy();
    expect(mount.querySelector<HTMLButtonElement>('.project-folder-field button')?.textContent).toContain('Ordner auswählen');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    mount.remove();
  }
});

it('restores project actions after a saved project loads', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    projects: async () => [{ id: 'synthetic-project', name: 'Synthetic project', path: 'C:\\synthetic', createdAt: '2026-01-01T00:00:00.000Z' }],
    projectOrganization: async () => ({ groups: [], assignments: {}, sort: 'name' }),
    snapshot: async () => new Promise<never>(() => undefined),
    reviewInboxItems: async () => ({ items: [], hasMore: false }),
    onSessionEvent: () => () => undefined,
    onBrowserSearchShortcut: () => () => undefined,
  } });
  try {
    await act(async () => { root.render(<App />); });
    expect(mount.querySelector('.sidebar-projects')).toBeTruthy();
    expect(mount.querySelector('.project-actions summary')?.textContent).toContain('Projektaktionen');
    expect(mount.querySelector<HTMLSelectElement>('#project-select')?.value).toBe('synthetic-project');
    expect(mount.querySelector('.project-switcher-trigger')).toBeTruthy();
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    mount.remove();
  }
});
