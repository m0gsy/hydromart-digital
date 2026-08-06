import {
  BUSINESS_TIME_ZONE,
  addLocalDays,
  addLocalMonths,
  dayStartUtc,
  localDayKey,
  localDayRange,
  localHour,
  localMonthKey,
  localMonthRange,
  startOfLocalDay,
  startOfLocalMonth,
  zoneOffsetMs,
} from './business-time';
import { money } from './money';

// 2026-08-04 23:30 WIB is 16:30 UTC the same day; 2026-08-04 02:00 WIB is 19:00 UTC on
// the 3rd. Those two are the whole point: a UTC day boundary splits a WIB business day.
const LATE_EVENING_WIB = new Date('2026-08-04T16:30:00Z');
const EARLY_MORNING_WIB = new Date('2026-08-03T19:00:00Z');

describe('business-time', () => {
  it('defaults to WIB', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Jakarta');
    expect(zoneOffsetMs(LATE_EVENING_WIB)).toBe(7 * 60 * 60 * 1000);
  });

  it('puts a late-evening WIB order on the WIB day, not the UTC one', () => {
    expect(localDayKey(LATE_EVENING_WIB)).toBe('2026-08-04');
    expect(EARLY_MORNING_WIB.toISOString().slice(0, 10)).toBe('2026-08-03');
    expect(localDayKey(EARLY_MORNING_WIB)).toBe('2026-08-04');
  });

  it('starts the local day at 17:00 UTC the day before', () => {
    expect(startOfLocalDay(LATE_EVENING_WIB).toISOString()).toBe('2026-08-03T17:00:00.000Z');
    expect(dayStartUtc('2026-08-04').toISOString()).toBe('2026-08-03T17:00:00.000Z');
  });

  it('rejects a malformed day key rather than inventing an instant', () => {
    expect(() => dayStartUtc('not-a-date')).toThrow(RangeError);
  });

  it('builds a half-open local day range', () => {
    const { from, to } = localDayRange(LATE_EVENING_WIB);
    expect(from.toISOString()).toBe('2026-08-03T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-04T17:00:00.000Z');
    expect(LATE_EVENING_WIB >= from && LATE_EVENING_WIB < to).toBe(true);
  });

  it('adds local days across a month end', () => {
    expect(addLocalDays(new Date('2026-08-31T10:00:00Z'), 1).toISOString()).toBe(
      '2026-08-31T17:00:00.000Z',
    );
    expect(localDayKey(addLocalDays(new Date('2026-08-31T10:00:00Z'), 1))).toBe('2026-09-01');
    expect(localDayKey(addLocalDays(LATE_EVENING_WIB, -1))).toBe('2026-08-03');
  });

  it('brackets the local month', () => {
    expect(localMonthKey(EARLY_MORNING_WIB)).toBe('2026-08');
    expect(startOfLocalMonth(EARLY_MORNING_WIB).toISOString()).toBe('2026-07-31T17:00:00.000Z');
    const { from, to } = localMonthRange(EARLY_MORNING_WIB);
    expect(from.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(localDayKey(addLocalMonths(EARLY_MORNING_WIB, -1))).toBe('2026-07-01');
  });

  it('reads the local wall-clock hour, midnight included', () => {
    expect(localHour(LATE_EVENING_WIB)).toBe(23);
    expect(localHour(new Date('2026-08-03T17:00:00Z'))).toBe(0);
  });

  it('honours a zone other than the default', () => {
    // UTC+0: the same instant is still the 4th, but the day starts at 00:00Z.
    expect(localDayKey(LATE_EVENING_WIB, 'UTC')).toBe('2026-08-04');
    expect(startOfLocalDay(LATE_EVENING_WIB, 'UTC').toISOString()).toBe(
      '2026-08-04T00:00:00.000Z',
    );
    // A DST zone exercises the second offset pass: 2026-03-08 is the US spring forward.
    expect(startOfLocalDay(new Date('2026-03-08T18:00:00Z'), 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
  });
});

describe('money', () => {
  it('rounds to IDR minor units', () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(19_999.994)).toBe(19_999.99);
    expect(money(19_999.995)).toBe(20_000);
  });
});
