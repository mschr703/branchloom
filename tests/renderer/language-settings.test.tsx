// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { ProjectSettingsView } from '../../src/renderer/components/ProjectSettingsView';
import { ProjectSwitcher } from '../../src/renderer/components/ProjectSwitcher';
import { viewName, WorkspaceNavigation } from '../../src/renderer/components/WorkspaceNavigation';
import { LANGUAGE_STORAGE_KEY, readLanguagePreference, writeLanguagePreference, type LanguagePreference } from '../../src/renderer/language';

describe('application language', () => {
  it('restores English, falls back to German, and tolerates blocked storage', () => {
    expect(readLanguagePreference({ getItem: () => 'en' })).toBe('en');
    expect(readLanguagePreference({ getItem: () => 'unknown' })).toBe('de');
    expect(readLanguagePreference({ getItem: () => { throw new Error('blocked'); } })).toBe('de');
    const saved: [string, string][] = [];
    writeLanguagePreference({ setItem: (key, value) => saved.push([key, value]) }, 'en');
    expect(saved).toEqual([[LANGUAGE_STORAGE_KEY, 'en']]);
    expect(() => writeLanguagePreference({ setItem: () => { throw new Error('blocked'); } }, 'de')).not.toThrow();
  });

  it('exposes Settings without a project and labels navigation in English', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    try {
      const app = renderToStaticMarkup(createElement(App));
      expect(app).toContain('aria-label="Settings"');
      expect(app).toContain('<h1>Start</h1>');
      const navigation = renderToStaticMarkup(<WorkspaceNavigation activeView="board" language="en" decisionCount={2} onView={() => undefined} status={{ activeCards: 4, runningSessions: 1 }} />);
      expect(navigation).toContain('aria-label="Ideas"');
      expect(navigation).toContain('aria-label="Decisions: 2 open"');
      expect(navigation).toContain('aria-label="Open agent sessions: 1 active"');
      expect(navigation).toContain('1</strong> active run');
      expect(viewName('settings', 'en')).toBe('Settings');
      const switcher = renderToStaticMarkup(<ProjectSwitcher language="en" projects={[{ id: 'project', name: 'Fixture', path: '/fixture', createdAt: '' }]} projectId="project" organization={{ groups: [], assignments: {}, sort: 'name' }} onSelect={() => undefined} onOrganizationChange={() => undefined} onError={() => undefined} />);
      expect(switcher).toContain('aria-label="Select project: Fixture"');
    } finally { localStorage.removeItem(LANGUAGE_STORAGE_KEY); }
  });

  it('opens Settings from the first-run header and persists an English selection', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const originalApi = Object.getOwnPropertyDescriptor(window, 'studio');
    Object.defineProperty(window, 'studio', { configurable: true, value: {
      projects: async () => [],
      projectOrganization: async () => ({ groups: [], assignments: {}, sort: 'name' }),
      onBrowserSearchShortcut: () => () => undefined,
    } });
    const host = document.createElement('div'); document.body.append(host);
    let root = createRoot(host);
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    try {
      await act(async () => { root.render(<App />); });
      await act(async () => { await Promise.resolve(); });
      expect(host.textContent).toContain('Dein Projekt beginnt mit einem Ordner.');
      await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Einstellungen"]')!.click(); });
      expect(host.textContent).toContain('Weitere Projektansichten werden noch übersetzt.');
      await act(async () => { host.querySelector<HTMLInputElement>('input[value="en"]')!.click(); });
      expect(document.documentElement.lang).toBe('en');
      expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
      expect(host.querySelector('h1')?.textContent).toBe('Settings');
      expect(host.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')).not.toBeNull();
      await act(async () => { root.unmount(); });
      root = createRoot(host);
      await act(async () => { root.render(<App />); });
      await act(async () => { await Promise.resolve(); });
      expect(host.textContent).toContain('Start with your project folder.');
      expect(document.documentElement.lang).toBe('en');
    } finally {
      await act(async () => { root.unmount(); }); host.remove(); localStorage.removeItem(LANGUAGE_STORAGE_KEY);
      if (originalApi) Object.defineProperty(window, 'studio', originalApi); else Reflect.deleteProperty(window, 'studio');
    }
  });

  it('switches the language in Settings while preserving the selected option', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    function Fixture() {
      const [language, setLanguage] = useState<LanguagePreference>('de');
      return <ProjectSettingsView language={language} onLanguageChange={setLanguage} />;
    }
    try {
      await act(async () => { root.render(<Fixture />); });
      expect(host.textContent).toContain('Weitere Projektansichten werden noch übersetzt.');
      const english = host.querySelector<HTMLInputElement>('input[value="en"]')!;
      await act(async () => { english.click(); });
      expect(english.checked).toBe(true);
      expect(host.textContent).toContain('Other project views are still being translated.');
      expect(host.querySelector<HTMLInputElement>('input[value="de"]')?.checked).toBe(false);
    } finally { await act(async () => { root.unmount(); }); host.remove(); }
  });
});
