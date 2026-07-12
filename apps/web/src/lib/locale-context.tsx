'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { id, type Dictionary } from './dictionaries/id';
import { en } from './dictionaries/en';

export type Locale = 'id' | 'en';

const DICTS: Record<Locale, Dictionary> = { id, en };
const STORAGE_KEY = 'hydromart.locale';

interface LocaleValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggle: () => void;
  /** dot-addressed lookup, e.g. t('nav.shop'); falls back to the key if missing */
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleValue | null>(null);

function resolve(dict: Dictionary, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], dict);
  return typeof value === 'string' ? value : key;
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

  const t = useCallback((key: string) => resolve(DICTS[locale], key), [locale]);

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
