import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { readThemePreference, THEME_STORAGE_KEY, themeToggleLabel, writeThemePreference } from '../../src/renderer/theme';

describe('theme preference', () => {
  it('uses a saved choice over the system preference and falls back for invalid values', () => {
    expect(readThemePreference({ getItem: () => 'light' }, false)).toBe('light');
    expect(readThemePreference({ getItem: () => 'dark' }, true)).toBe('dark');
    expect(readThemePreference({ getItem: () => 'unknown' }, true)).toBe('light');
    expect(readThemePreference(null, false)).toBe('dark');
  });

  it('survives blocked storage for reading and writing', () => {
    expect(readThemePreference({ getItem: () => { throw new Error('blocked'); } }, true)).toBe('light');
    expect(() => writeThemePreference({ setItem: () => { throw new Error('blocked'); } }, 'dark')).not.toThrow();
    const writes: [string, string][] = [];
    writeThemePreference({ setItem: (key, value) => { writes.push([key, value]); } }, 'light');
    expect(writes).toEqual([[THEME_STORAGE_KEY, 'light']]);
  });

  it('provides a named theme control while project search stays hidden on first run', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain(`aria-label="${themeToggleLabel('dark')}"`);
    expect(html).toContain('<h1>Start</h1>');
    expect(html).not.toContain('Projekt durchsuchen');
  });
});
