'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { callPlugin } from './capacitor';

// App-wide theme (design 24b). `system` follows the OS media query; `light`/`dark`
// stamp an explicit data-theme on <html> which globals.css lets win over the query.
// Persisted in localStorage. The toggle UI is HQ-only, but the provider is app-wide
// so the choice sticks everywhere.
export type Theme = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'hydromart.theme';

interface ThemeValue {
  theme: Theme;
  resolved: Resolved;
  setTheme: (t: Theme) => void;
  /** Flip between light and dark (from the currently resolved value). */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function applyAttr(theme: Theme) {
  const el = document.documentElement;
  if (theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      setThemeState(saved);
      applyAttr(saved);
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    applyAttr(t);
  }, []);

  const resolved: Resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  /**
   * The Android status bar follows the theme the app actually resolved to, not the one
   * that was picked: 'system' is two different answers depending on the phone, and the
   * clock was staying dark-on-dark either way. Keyed on `resolved`, so all three states —
   * light, dark, and system flipping underneath — land, and immediately.
   *
   * The plugin's `style` names the BACKGROUND it is for, not the icons: 'DARK' draws light
   * icons for a dark bar, 'LIGHT' draws dark icons for a light one. Reading it the other
   * way round is how this ends up invisible in exactly one theme. No-op on the web.
   */
  useEffect(() => {
    callPlugin('StatusBar', 'setStyle', { style: resolved === 'dark' ? 'DARK' : 'LIGHT' });
  }, [resolved]);

  const value = useMemo<ThemeValue>(
    () => ({ theme, resolved, setTheme, toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark') }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
