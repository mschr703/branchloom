import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { readThemePreference, THEME_STORAGE_KEY, themeColorScheme, themeToggleLabel, writeThemePreference } from '../../src/renderer/theme';
import { ThemeSettings } from '../../src/renderer/components/ThemeSettings';

describe('theme preference', () => {
  it('uses a saved choice over the system preference and falls back for invalid values', () => {
    expect(readThemePreference({ getItem: () => 'light' })).toBe('light');
    expect(readThemePreference({ getItem: () => 'dark' })).toBe('dark');
    expect(readThemePreference({ getItem: () => 'stone' })).toBe('stone');
    expect(readThemePreference({ getItem: () => 'ink' })).toBe('ink');
    expect(readThemePreference({ getItem: () => 'unknown' })).toBe('light');
    expect(readThemePreference(null)).toBe('light');
  });

  it('keeps the base light and dark selectors for alternate palettes', () => {
    expect(themeColorScheme('light')).toBe('light');
    expect(themeColorScheme('stone')).toBe('light');
    expect(themeColorScheme('dark')).toBe('dark');
    expect(themeColorScheme('ink')).toBe('dark');
    expect(themeToggleLabel('ink')).toBe('Helles Design aktivieren');
  });

  it('shows four named choices and selects the persisted preference', () => {
    const html = renderToStaticMarkup(createElement(ThemeSettings, { theme: 'stone', language: 'en', onChange: () => undefined }));
    expect(html).toMatch(/name="app-theme"[^>]*checked=""[^>]*value="stone"/);
    expect(html).toContain('Quiet neutral');
    expect(html).toContain('Warm paper');
    expect(html).toContain('Muted charcoal');
    expect(html).toContain('Deep black');
  });

  it('survives blocked storage for reading and writing', () => {
    expect(readThemePreference({ getItem: () => { throw new Error('blocked'); } })).toBe('light');
    expect(() => writeThemePreference({ setItem: () => { throw new Error('blocked'); } }, 'dark')).not.toThrow();
    const writes: [string, string][] = [];
    writeThemePreference({ setItem: (key, value) => { writes.push([key, value]); } }, 'light');
    expect(writes).toEqual([[THEME_STORAGE_KEY, 'light']]);
  });

  it('provides a named theme control while project search stays hidden on first run', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain(`aria-label="${themeToggleLabel('light')}"`);
    expect(html).toContain('<h1>Start</h1>');
    expect(html).not.toContain('Projekt durchsuchen');
  });
});
