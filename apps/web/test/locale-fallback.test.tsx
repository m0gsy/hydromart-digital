/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
