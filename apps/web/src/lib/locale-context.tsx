'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { id, type Dictionary } from './dictionaries/id';
import { en } from './dictionaries/en';

export type Locale = 'id' | 'en';

const DICTS: Record<Locale, Dictionary> = { id, en };
const STORAGE_KEY = 'hydromart.locale';

export type TVars = Record<string, string | number>;

interface LocaleValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggle: () => void;
  /**
   * Dot-addressed lookup, e.g. t('nav.shop'); falls back to the key if missing.
   * `{token}` placeholders in the value are filled from `vars`, e.g.
   * t('rewards.toNext', { n: 750, tier: 'GOLD' }).
   */
  t: (key: string, vars?: TVars) => string;
}

const LocaleContext = createContext<LocaleValue | null>(null);

function resolve(dict: Dictionary, key: string, vars?: TVars): string {
  const value = key
    .split('.')
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], dict);
  if (typeof value !== 'string') return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('id');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'id' || saved === 'en') setLocaleState(saved);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback((key: string, vars?: TVars) => resolve(DICTS[locale], key, vars), [locale]);

  const value = useMemo<LocaleValue>(
    () => ({ locale, setLocale, toggle: () => setLocale(locale === 'id' ? 'en' : 'id'), t }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useT must be used within <LocaleProvider>');
  return ctx;
}
