import { describe, expect, it } from 'vitest';

import { compare, formatPct } from '@/lib/insight/delta';
import {
  granularityFor,
  groupingsFor,
  isValidRange,
  previousRange,
  rangeFor,
  regroup,
  spanDays,
  yearAgoRange,
} from '@/lib/insight/range';

/**
 * Every case that matters here sits at an instant between 00:00 and 07:00 WIB, where the UTC
 * date is still yesterday: a window built from the device's UTC day is wrong exactly then,
 * and exactly then is when a depot opens.
 */

/** 2026-10-15 03:00 WIB = 2026-10-14 20:00 UTC. */
const EARLY = new Date('2026-10-14T20:00:00.000Z');

describe('rangeFor', () => {
  it('starts today at 00:00 WIB and ends at the next 00:00 (exclusive)', () => {
    expect(rangeFor('today', EARLY)).toEqual({
      from: '2026-10-14T17:00:00.000Z',
      to: '2026-10-15T17:00:00.000Z',
      preset: 'today',
    });
  });

  it('runs Monday to the next Monday', () => {
    // 2026-10-15 is a Thursday, so the week is 12 October .. 19 October.
    expect(rangeFor('week', EARLY)).toEqual({
      from: '2026-10-11T17:00:00.000Z',
      to: '2026-10-18T17:00:00.000Z',
      preset: 'week',
    });
  });

  it('covers the whole business month', () => {
    expect(rangeFor('month', EARLY)).toEqual({
      from: '2026-09-30T17:00:00.000Z',
      to: '2026-10-31T17:00:00.000Z',
      preset: 'month',
    });
  });

  it('treats a custom end date as inclusive on screen and exclusive on the wire', () => {
    expect(rangeFor('custom', EARLY, { from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-09-30T17:00:00.000Z',
      to: '2026-10-31T17:00:00.000Z',
      preset: 'custom',
    });
  });

  it('falls back to the month when a custom range has no dates yet', () => {
    expect(rangeFor('custom', EARLY).preset).toBe('month');
  });
});

describe('isValidRange / spanDays', () => {
  it('accepts a day and a year-and-a-day, refuses nothing or too long or reversed', () => {
    const oneDay = rangeFor('today', EARLY);
    expect(spanDays(oneDay)).toBe(1);
    expect(isValidRange(oneDay)).toBe(true);
    const year = rangeFor('custom', EARLY, { from: '2025-10-15', to: '2026-10-15' });
    expect(spanDays(year)).toBe(366);
    expect(isValidRange(year)).toBe(true);
    const tooLong = rangeFor('custom', EARLY, { from: '2025-10-14', to: '2026-10-15' });
    expect(isValidRange(tooLong)).toBe(false);
    expect(isValidRange({ from: oneDay.to, to: oneDay.from })).toBe(false);
    expect(isValidRange({ from: oneDay.from, to: oneDay.from })).toBe(false);
  });
});

describe('previousRange', () => {
  it('compares a month with the previous CALENDAR month, not 30 days back', () => {
    // October (31 days) against September (30 days).
    expect(previousRange(rangeFor('month', EARLY))).toEqual({
      from: '2026-08-31T17:00:00.000Z',
      to: '2026-09-30T17:00:00.000Z',
      preset: 'month',
    });
  });

  it('compares a week with the week before and a day with the day before', () => {
    expect(previousRange(rangeFor('week', EARLY))).toEqual({
      from: '2026-10-04T17:00:00.000Z',
      to: '2026-10-11T17:00:00.000Z',
      preset: 'week',
    });
    expect(previousRange(rangeFor('today', EARLY))).toEqual({
      from: '2026-10-13T17:00:00.000Z',
      to: '2026-10-14T17:00:00.000Z',
      preset: 'today',
    });
  });

  it('compares a custom window with the same number of days right before it', () => {
    const r = rangeFor('custom', EARLY, { from: '2026-10-10', to: '2026-10-14' });
    const p = previousRange(r);
    expect(spanDays(p)).toBe(spanDays(r));
    expect(p.to).toBe(r.from);
  });

  it('steps back across a year boundary', () => {
    const jan = rangeFor('month', new Date('2027-01-10T05:00:00.000Z'));
    expect(previousRange(jan).from).toBe('2026-11-30T17:00:00.000Z');
  });
});

describe('yearAgoRange', () => {
  it('moves both bounds back exactly one calendar year', () => {
    expect(yearAgoRange(rangeFor('month', EARLY))).toEqual({
      from: '2025-09-30T17:00:00.000Z',
      to: '2025-10-31T17:00:00.000Z',
      preset: 'month',
    });
  });

  it('lands 29 February on the 28th of a non-leap year, and keeps a leap year whole', () => {
    // 2028 is a leap year; 2027 is not.
    const leapDay = rangeFor('custom', EARLY, { from: '2028-02-29', to: '2028-02-29' });
    expect(yearAgoRange(leapDay).from).toBe('2027-02-27T17:00:00.000Z');
    const normal = rangeFor('custom', EARLY, { from: '2028-03-01', to: '2028-03-01' });
    expect(yearAgoRange(normal).from).toBe('2027-02-28T17:00:00.000Z');
  });
});

describe('regroup', () => {
  const daily = [
    { period: '2026-10-05', orderCount: 1, revenue: 100 },
    { period: '2026-10-11', orderCount: 2, revenue: 200 }, // Sunday: still the week of the 5th
    { period: '2026-10-12', orderCount: 3, revenue: 300 }, // Monday: a new week
    { period: '2026-11-02', orderCount: 4, revenue: 400 },
  ];

  it('keeps days as they are', () => {
    expect(regroup(daily, 'day')).toEqual(daily);
  });

  it('folds days into Monday-based weeks, labelled by the Monday', () => {
    expect(regroup(daily, 'week')).toEqual([
      { period: '2026-10-05', orderCount: 3, revenue: 300 },
      { period: '2026-10-12', orderCount: 3, revenue: 300 },
      { period: '2026-11-02', orderCount: 4, revenue: 400 },
    ]);
  });

  it('folds into months and quarters, across a year end', () => {
    expect(regroup(daily, 'month').map((b) => [b.period, b.revenue])).toEqual([
      ['2026-10', 600],
      ['2026-11', 400],
    ]);
    const monthly = [
      { period: '2026-12', orderCount: 1, revenue: 10 },
      { period: '2027-01', orderCount: 1, revenue: 20 },
      { period: '2027-03', orderCount: 1, revenue: 30 },
    ];
    expect(regroup(monthly, 'quarter')).toEqual([
      { period: '2026-Q4', orderCount: 1, revenue: 10 },
      { period: '2027-Q1', orderCount: 2, revenue: 50 },
    ]);
  });

  it('does not mutate its input and handles an empty series', () => {
    const copy = JSON.parse(JSON.stringify(daily));
    regroup(daily, 'week');
    expect(daily).toEqual(copy);
    expect(regroup([], 'week')).toEqual([]);
  });
});

describe('groupingsFor / granularityFor', () => {
  it('offers only groupings that read well for the window length', () => {
    expect(groupingsFor(rangeFor('week', EARLY))).toEqual(['day', 'week']);
    const sixty = rangeFor('custom', EARLY, { from: '2026-08-01', to: '2026-09-29' });
    expect(groupingsFor(sixty)).toEqual(['day', 'week', 'month']);
    const year = rangeFor('custom', EARLY, { from: '2025-10-15', to: '2026-10-15' });
    expect(groupingsFor(year)).toEqual(['week', 'month', 'quarter']);
  });

  it('feeds month and quarter from the monthly series and the rest from the daily one', () => {
    expect(granularityFor('day')).toBe('daily');
    expect(granularityFor('week')).toBe('daily');
    expect(granularityFor('month')).toBe('monthly');
    expect(granularityFor('quarter')).toBe('monthly');
  });
});

describe('compare', () => {
  it('reports growth and decline as a magnitude with a direction', () => {
    expect(compare(110, 100)).toEqual({ kind: 'up', pct: 10 });
    expect(compare(90, 100)).toEqual({ kind: 'down', pct: 10 });
  });

  it('calls a negligible change flat, not movement', () => {
    expect(compare(100.01, 100)).toEqual({ kind: 'flat', pct: 0 });
    expect(compare(100, 100)).toEqual({ kind: 'flat', pct: 0 });
  });

  it('says there is nothing to compare when the base is missing, zero or not a number', () => {
    expect(compare(100, null)).toEqual({ kind: 'none' });
    expect(compare(null, 100)).toEqual({ kind: 'none' });
    expect(compare(100, 0)).toEqual({ kind: 'none' });
    expect(compare(0, 0)).toEqual({ kind: 'none' });
    expect(compare(100, -5)).toEqual({ kind: 'none' });
    expect(compare(Number.NaN, 100)).toEqual({ kind: 'none' });
    expect(compare(100, Number.POSITIVE_INFINITY)).toEqual({ kind: 'none' });
  });

  it('still reports a drop to zero against a real base', () => {
    expect(compare(0, 100)).toEqual({ kind: 'down', pct: 100 });
  });

  it('prints one decimal with a comma', () => {
    expect(formatPct(12.34)).toBe('12,3');
    expect(formatPct(100)).toBe('100,0');
  });
});
