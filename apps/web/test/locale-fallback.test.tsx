/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { LocaleProvider, useT } from '@/lib/locale-context';

/**
 * `t(MAP[value])` is a shape used ~40 times across the console: a dictionary key looked up
 * by an enum member. One member the map does not carry makes the argument `undefined`, and
 * `undefined.split('.')` is an uncaught TypeError — not a missing label, a white screen
 * with no error state. `/hr/me/payroll/detail` did exactly this in the 2026-08-14 sweep.
 */
describe('t() survives a key that is not there', () => {
  function render(key: unknown) {
    const { result } = renderHook(() => useT(), { wrapper: LocaleProvider });
    return result.current.t(key as string);
  }

  it('returns an empty string instead of throwing', () => {
    expect(render(undefined)).toBe('');
    expect(render(null)).toBe('');
    expect(render('')).toBe('');
  });

  it('still returns the key itself for a well-formed miss, which is the signal a sweep reads', () => {
    expect(render('opsFix.nope.notAKey')).toBe('opsFix.nope.notAKey');
  });
});

/**
 * `<html lang>` used to be stamped only by `setLocale`, so it only ever matched when someone
 * flipped the switch in THAT document. A returning English reader got English text under
 * `lang="id"` on every page — and a screen reader read all of it with Indonesian
 * pronunciation, which is the one reader who cannot see that it is wrong.
 */
describe('<html lang> follows the locale', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'id';
  });

  it('is stamped from the restored choice, with nobody touching the switch', async () => {
    localStorage.setItem('hydromart.locale', 'en');
    renderHook(() => useT(), { wrapper: LocaleProvider });

    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });

  it('follows the switch too, and back again', async () => {
    const { result } = renderHook(() => useT(), { wrapper: LocaleProvider });
    expect(document.documentElement.lang).toBe('id');

    act(() => result.current.setLocale('en'));
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));

    act(() => result.current.setLocale('id'));
    await waitFor(() => expect(document.documentElement.lang).toBe('id'));
  });
});
