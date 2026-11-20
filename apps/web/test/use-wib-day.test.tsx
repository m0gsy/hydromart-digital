// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MIN_DAY, useWibDay } from '@/lib/use-wib-day';

/*
 * Flow 8c review: the day pickers on payment reconciliation and the cash book.
 * - "Today" must roll over at WIB midnight on its own: a console left open overnight came back
 *   reading yesterday once the day was fixed at mount.
 * - A year being typed passes through 0002/0020/0202; dayStartWib throws before 1924, so a
 *   partial value must never become the day.
 */

const change = (value: string) => ({ target: { value } }) as unknown as ChangeEvent<HTMLInputElement>;

afterEach(() => vi.useRealTimers());

describe('useWibDay', () => {
  it('is today in WIB, and rolls over at WIB midnight while nothing is picked', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T16:59:00.000Z')); // 23:59 WIB on the 19th
    const { result, rerender } = renderHook(() => useWibDay());
    expect(result.current.day).toBe('2026-11-19');
    expect(result.current.isToday).toBe(true);

    vi.setSystemTime(new Date('2026-11-19T17:01:00.000Z')); // 00:01 WIB on the 20th
    // A loader asks at call time, before any re-render.
    expect(result.current.current()).toBe('2026-11-20');
    rerender();
    expect(result.current.day).toBe('2026-11-20');
  });

  // Review: a form page keeps its day across midnight, so a late save goes where it was typed.
  it('stays on its day across WIB midnight when it does not roll over', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T16:59:00.000Z')); // 23:59 WIB on the 19th
    const { result, rerender } = renderHook(() => useWibDay(false));
    expect(result.current.day).toBe('2026-11-19');
    vi.setSystemTime(new Date('2026-11-19T17:02:00.000Z')); // 00:02 WIB on the 20th
    rerender();
    expect(result.current.day).toBe('2026-11-19');
    expect(result.current.current()).toBe('2026-11-19');
    // …and now it is an earlier day: the page asks for a reason.
    expect(result.current.isToday).toBe(false);
    act(() => result.current.reset());
    expect(result.current.day).toBe('2026-11-20');
  });

  it('keeps a picked day, refuses partial or future values, and returns to rolling on today', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T03:00:00.000Z'));
    const { result } = renderHook(() => useWibDay());

    act(() => result.current.inputProps.onChange(change('2026-11-10')));
    expect(result.current.day).toBe('2026-11-10');
    expect(result.current.isToday).toBe(false);

    for (const partial of ['0002-11-10', '0202-11-10', '2019-12-31', '2026-11-21', '']) {
      act(() => result.current.inputProps.onChange(change(partial)));
      expect(result.current.day).toBe('2026-11-10');
      // The field still shows what is being typed.
      expect(result.current.inputProps.value).toBe(partial);
    }
    act(() => result.current.inputProps.onBlur());
    expect(result.current.inputProps.value).toBe('2026-11-10');
    expect(result.current.inputProps.min).toBe(MIN_DAY);

    act(() => result.current.inputProps.onChange(change('2026-11-20')));
    expect(result.current.isToday).toBe(true);
    // Picking today is "today", which rolls over again.
    vi.setSystemTime(new Date('2026-11-20T17:30:00.000Z'));
    expect(result.current.current()).toBe('2026-11-21');

    act(() => result.current.inputProps.onChange(change('2026-11-15')));
    act(() => result.current.reset());
    expect(result.current.day).toBe('2026-11-21');
  });
});
