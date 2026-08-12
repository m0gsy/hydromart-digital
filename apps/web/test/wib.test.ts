import { afterEach, describe, expect, it, vi } from 'vitest';

import { mondayWib, monthWib, todayWib, wibParts } from '@/lib/wib';

/**
 * C3 — the business day in the browser.
 *
 * Every case here is pinned at an instant inside the 00:00–07:00 WIB window, because that
 * is the only window where the two old implementations and the correct one disagree — and
 * it is the window a depot opening up actually works in. A test written at 15:00 WIB passes
 * against all three and proves nothing.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** 2026-03-10 01:30 WIB is 2026-03-09 18:30 UTC — a different calendar day. */
const EARLY_MORNING = new Date('2026-03-09T18:30:00.000Z');

describe('todayWib', () => {
  it('names the WIB day, not the UTC one, before 07:00', () => {
    expect(todayWib(EARLY_MORNING)).toBe('2026-03-10');
    // What the old code did, kept here so the difference is visible rather than asserted
    // in the abstract.
    expect(EARLY_MORNING.toISOString().slice(0, 10)).toBe('2026-03-09');
  });

  it('is stable whatever the machine clock is set to', () => {
    // The runner is UTC and this laptop is WIB; two developers must not get two answers.
    expect(todayWib(EARLY_MORNING)).toBe('2026-03-10');
  });

  it('defaults to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(EARLY_MORNING);
    expect(todayWib()).toBe('2026-03-10');
  });
});

describe('monthWib', () => {
  it('rolls the month at the WIB boundary, not the UTC one', () => {
    // 2026-04-01 00:30 WIB = 2026-03-31 17:30 UTC. The UTC answer is the previous MONTH,
    // so a monthly report opened first thing on the 1st asked for March.
    const t = new Date('2026-03-31T17:30:00.000Z');
    expect(monthWib(t)).toBe('2026-04');
    expect(t.toISOString().slice(0, 7)).toBe('2026-03');
  });
});

describe('mondayWib', () => {
  it('walks back to Monday, and stays put when it already is one', () => {
    // 2026-03-10 is a Tuesday in WIB.
    expect(mondayWib(EARLY_MORNING)).toBe('2026-03-09');
    expect(mondayWib(new Date('2026-03-08T18:30:00.000Z'))).toBe('2026-03-09');
  });

  it('treats Sunday as the END of its week, not the start', () => {
    // 2026-03-15 is a Sunday. A `getDay()`-based offset that forgets this jumps FORWARD a
    // day and reports a week that has not happened yet.
    expect(mondayWib(new Date('2026-03-15T05:00:00.000Z'))).toBe('2026-03-09');
  });
});

describe('wibParts', () => {
  it('gives calendar parts in WIB', () => {
    expect(wibParts(EARLY_MORNING)).toEqual({ year: 2026, month: 3, day: 10 });
  });
});
