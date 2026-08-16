'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { id, type Dictionary } from './dictionaries/id';

export type Locale = 'id' | 'en';

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

/**
 * Audit F-5: both dictionaries used to be static imports, so EVERY route in the app
 * carried ~1,900 Indonesian strings AND ~1,900 English ones — and virtually every
 * visitor reads one of them. Indonesian is the product default and ships eagerly;
 * English arrives as its own chunk the first time someone asks for it.
 *
 * The cache is module-level so a second toggle is free, and the promise is memoised so
 * two components flipping the switch in the same tick share one download.
 */
const loaded: Partial<Record<Locale, Dictionary>> = { id };
let enLoading: Promise<Dictionary> | null = null;

function loadDictionary(locale: Locale): Promise<Dictionary> {
  if (locale === 'id') return Promise.resolve(id);
  if (!enLoading) {
    enLoading = import('./dictionaries/en').then((m) => {
      loaded.en = m.en;
      return m.en;
    });
  }
  return enLoading;
}

function resolve(dict: Dictionary, key: string, vars?: TVars): string {
  // Every `t(MAP[value])` in the app is one unexpected enum member away from calling this
  // with `undefined`, and `undefined.split` is an uncaught TypeError — a white screen with
  // no error state, which is what `/hr/me/payroll/detail` did. The guard belongs here
  // rather than at each of the ~40 call sites: they all arrive through this one function.
  if (typeof key !== 'string' || !key) return '';
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
  // Bumped when a lazily-fetched dictionary lands, so `t` re-runs against it.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'id' || saved === 'en') setLocaleState(saved);
  }, []);

  // `<html lang>` follows the locale wherever the locale came from. It used to be stamped
  // only by `setLocale`, i.e. only when someone flipped the switch in THIS document — so a
  // returning English reader got English text under `lang="id"` on every page, and a screen
  // reader pronounced all of it as Indonesian. The layout's static `lang="id"` is the
  // server's honest answer (the choice lives in localStorage); this is where it stops being
  // the answer. An effect, so nothing about the first paint changes and hydration still
  // matches the prerendered HTML.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  // Fetch whatever the current locale needs. Until it lands, `t` falls back to
  // Indonesian — one paint of the default beats blocking the whole tree on a chunk.
  useEffect(() => {
    if (loaded[locale]) return;
    let alive = true;
    void loadDictionary(locale).then(() => alive && setRevision((r) => r + 1));
    return () => {
      alive = false;
    };
  }, [locale]);

  const t = useCallback(
    (key: string, vars?: TVars) => resolve(loaded[locale] ?? id, key, vars),
    // `revision` is the signal that `loaded` changed — it has no other reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, revision],
  );

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
