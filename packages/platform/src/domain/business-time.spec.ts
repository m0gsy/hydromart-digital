import {
  BUSINESS_TIME_ZONE,
  addLocalDays,
  addLocalMonths,
  dayStartUtc,
  localDayKey,
  localDayRange,
  localHour,
  localMinutesOfDay,
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
    expect(startOfLocalDay(LATE_EVENING_WIB, 'UTC').toISOString()).toBe('2026-08-04T00:00:00.000Z');
    // A DST zone exercises the second offset pass: 2026-03-08 is the US spring forward.
    expect(
      startOfLocalDay(new Date('2026-03-08T18:00:00Z'), 'America/New_York').toISOString(),
    ).toBe('2026-03-08T05:00:00.000Z');
  });
});

// C4: every period function must give the SAME answer whatever the machine's clock is set
// to. Two of these were caught green on a WIB laptop and red on a UTC runner — the gap this
// suite exists to close. `process.env.TZ` is read by V8 the first time a Date is formatted,
// so this reaches under the helpers rather than trusting them.
describe('period functions are independent of the machine clock', () => {
  const AT = new Date('2026-07-31T18:30:00.000Z'); // 01:30 WIB on 1 August

  const answers = () => ({
    day: localDayKey(AT, 'Asia/Jakarta'),
    month: localMonthKey(AT, 'Asia/Jakarta'),
    hour: localHour(AT, 'Asia/Jakarta'),
    minutes: localMinutesOfDay(AT, 'Asia/Jakarta'),
    dayStart: startOfLocalDay(AT, 'Asia/Jakarta').toISOString(),
    monthStart: startOfLocalMonth(AT, 'Asia/Jakarta').toISOString(),
    offset: zoneOffsetMs(AT, 'Asia/Jakarta'),
  });

  it('gives identical answers under TZ=UTC and TZ=Pacific/Auckland', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = answers();
      process.env.TZ = 'Pacific/Auckland';
      const auckland = answers();
      expect(auckland).toEqual(utc);
      // …and the answers are the WIB ones, not either machine's.
      expect(utc).toMatchObject({
        day: '2026-08-01',
        month: '2026-08',
        hour: 1,
        minutes: 90,
        offset: 7 * 60 * 60 * 1000,
      });
    } finally {
      process.env.TZ = original;
    }
  });
});

/**
 * `money` rounds to WHOLE rupiah since 2026-08-13 — there is no circulating sub-rupiah coin, no
 * receipt prints one, and keeping two decimals meant the server stored `4.999,95` while every
 * price on screen was whole. These three cases used to pin the old contract; the rule itself now
 * has a spec of its own in test/money.spec.ts, and this keeps the float-drift case that lived
 * here.
 */
describe('money', () => {
  it('rounds to whole rupiah and never leaks float drift', () => {
    expect(money(0.1 + 0.2)).toBe(0);
    expect(money(19_999.994)).toBe(20_000);
    expect(money(19_999.4)).toBe(19_999);
  });
});
