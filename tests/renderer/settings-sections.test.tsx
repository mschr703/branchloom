// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectSettingsView } from '../../src/renderer/components/ProjectSettingsView';
import type { LanguagePreference } from '../../src/renderer/language';

afterEach(() => { document.body.replaceChildren(); });

describe('settings sections', () => {
  it('groups existing project controls without duplicating them in the visible panel', () => {
    const html = renderToStaticMarkup(<ProjectSettingsView project={{ id: 'p', name: 'Fixture project', path: 'fixture', createdAt: '' }} onOpenAgents={() => undefined} />);
    expect(html).toContain('aria-label="Einstellungsbereiche"');
    for (const section of ['app', 'project', 'agents', 'browser', 'team', 'updates']) {
      expect(html).toContain(`id="settings-tab-${section}"`);
      expect(html).toContain(`id="settings-panel-${section}"`);
    }
    expect(html).toContain('aria-selected="true" aria-controls="settings-panel-app"');
    expect(html).toContain('id="settings-panel-browser" class="app-settings-panel" role="tabpanel" aria-labelledby="settings-tab-browser" hidden=""');
    expect(html).toContain('aria-label="Browser-Automation für Agenten"');
    expect(html).toContain('aria-label="Projektboard teilen"');
    expect(html).toContain('Agenten öffnen');
  });

  it('opens browser settings directly when routed from an agent or browser check', () => {
    const html = renderToStaticMarkup(<ProjectSettingsView
      project={{ id: 'p', name: 'Fixture project', path: 'fixture', createdAt: '' }} initialSection="browser" />);
    expect(html).toContain('id="settings-tab-browser" role="tab" type="button" aria-selected="true"');
    expect(html).toContain('id="settings-panel-browser" class="app-settings-panel" role="tabpanel" aria-labelledby="settings-tab-browser"');
    expect(html).not.toContain('aria-labelledby="settings-tab-browser" hidden=""');
  });

  it('keeps language state while switching sections and supports arrow navigation without a project', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    function Fixture() {
      const [language, setLanguage] = useState<LanguagePreference>('de');
      return <ProjectSettingsView language={language} onLanguageChange={setLanguage} />;
    }
    try {
      await act(async () => { root.render(<Fixture />); });
      const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      expect(tabs()).toHaveLength(2);
      await act(async () => { host.querySelector<HTMLInputElement>('input[value="en"]')!.click(); });
      expect(host.querySelector<HTMLInputElement>('input[value="en"]')?.checked).toBe(true);
      await act(async () => { tabs()[1]!.click(); });
      expect(host.querySelector('#settings-panel-updates')?.hasAttribute('hidden')).toBe(false);
      await act(async () => { tabs()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); });
      expect(host.querySelector('#settings-panel-app')?.hasAttribute('hidden')).toBe(false);
      expect(host.querySelector<HTMLInputElement>('input[value="en"]')?.checked).toBe(true);
      expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true');
    } finally {
      await act(async () => { root.unmount(); });
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      host.remove();
    }
  });
});
