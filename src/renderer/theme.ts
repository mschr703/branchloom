export type ThemePreference = 'dark' | 'light';

// Preserve the pre-rename key so users keep their chosen appearance.
export const THEME_STORAGE_KEY = 'jarvis-studio:theme';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readThemePreference(storage: Pick<ThemeStorage, 'getItem'> | null): ThemePreference {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Storage can be unavailable in restricted desktop/browser contexts.
  }
  return 'light';
}

export function writeThemePreference(storage: Pick<ThemeStorage, 'setItem'> | null, theme: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The current choice still applies for this session if storage is blocked.
  }
}

export function currentTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'light';
  let storage: Pick<ThemeStorage, 'getItem'> | null = null;
  try { storage = window.localStorage; } catch { /* Browser storage may be blocked. */ }
  return readThemePreference(storage);
}

export function persistTheme(theme: ThemePreference): void {
  let storage: Pick<ThemeStorage, 'setItem'> | null = null;
  try { storage = window.localStorage; } catch { /* Browser storage may be blocked. */ }
  writeThemePreference(storage, theme);
}

export function themeToggleLabel(theme: ThemePreference): string {
  return theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren';
}
