import {
  BREAK_AFTER_MINUTES,
  DayRule,
  formatMinutes,
  minuteRate,
  overtimePay,
  splitOvertime,
} from '../../src/domain/overtime';

const STANDARD = 480; // 8h

/** The shape payroll passes in: one rule for every day, break off, nothing off-day. */
const rules =
  (over: Partial<DayRule> = {}, offOn: readonly string[] = []) =>
  (workDate: string): DayRule => ({
    standardMinutes: STANDARD,
    breakMinutes: 0,
    offDay: offOn.includes(workDate),
    ...over,
  });

describe('splitOvertime', () => {
  it('counts only the minutes above the standard shift on an ordinary day', () => {
    const out = splitOvertime([{ workDate: '2026-03-02', workingMinutes: 600 }], rules());
    expect(out).toEqual({ regularMinutes: 120, offDayMinutes: 0, totalMinutes: 120 });
  });

  it('counts every worked minute on a weekly-off day or national holiday (M24-17)', () => {
    const out = splitOvertime(
      [
        { workDate: '2026-03-01', workingMinutes: 300 }, // off day
        { workDate: '2026-03-02', workingMinutes: 300 }, // ordinary, under standard
      ],
      rules({}, ['2026-03-01']),
    );
    expect(out).toEqual({ regularMinutes: 0, offDayMinutes: 300, totalMinutes: 300 });
  });

  it('treats a holiday exactly like a weekly-off day', () => {
    const holiday = splitOvertime(
      [{ workDate: '2026-03-20', workingMinutes: 240 }],
      rules({}, ['2026-03-20']),
    );
    const weeklyOff = splitOvertime(
      [{ workDate: '2026-03-01', workingMinutes: 240 }],
      rules({}, ['2026-03-01']),
    );
    expect(holiday).toEqual(weeklyOff);
  });

  it('ignores days that were never checked out and short ordinary days', () => {
    const out = splitOvertime(
      [
        { workDate: '2026-03-02', workingMinutes: null },
        { workDate: '2026-03-03', workingMinutes: 0 },
        { workDate: '2026-03-04', workingMinutes: 400 },
      ],
      rules(),
    );
    expect(out.totalMinutes).toBe(0);
  });

  it('reads the rule of the day it is looking at, not one rule for the month', () => {
    // A rota where Friday's shift is shorter: the same 540 minutes present is overtime on
    // Friday and is not on Thursday.
    const out = splitOvertime(
      [
        { workDate: '2026-03-05', workingMinutes: 540 },
        { workDate: '2026-03-06', workingMinutes: 540 },
      ],
      (d) => ({
        standardMinutes: d === '2026-03-06' ? 420 : 540,
        breakMinutes: 0,
        offDay: false,
      }),
    );
    expect(out).toEqual({ regularMinutes: 120, offDayMinutes: 0, totalMinutes: 120 });
  });
});

// CA-1-39. `workingMinutes` is the gap between the two punches and nobody punches out for
// lunch, so 08:00–17:00 recorded 540 against a 480 standard: one hour of overtime a day, for
// everyone, forever. D2 takes the break off first — 90 minutes on Friday, 60 otherwise, and
// only from a day of six hours or more.
describe('splitOvertime — the unpaid break (D2)', () => {
  it('stops paying the lunch hour as overtime on an ordinary day', () => {
    const day = [{ workDate: '2026-03-02', workingMinutes: 540 }];
    expect(splitOvertime(day, rules({ breakMinutes: 0 })).totalMinutes).toBe(60);
    expect(splitOvertime(day, rules({ breakMinutes: 60 })).totalMinutes).toBe(0);
  });

  it('takes the break off an off-day too, where every minute is paid at the higher rate', () => {
    const out = splitOvertime(
      [{ workDate: '2026-03-01', workingMinutes: 480 }],
      rules({ breakMinutes: 60 }, ['2026-03-01']),
    );
    expect(out).toEqual({ regularMinutes: 0, offDayMinutes: 420, totalMinutes: 420 });
  });

  it('leaves a day under six hours alone — there is no lunch hour to take off', () => {
    const short = BREAK_AFTER_MINUTES - 1;
    const out = splitOvertime(
      [{ workDate: '2026-03-01', workingMinutes: short }],
      rules({ breakMinutes: 60 }, ['2026-03-01']),
    );
    expect(out.offDayMinutes).toBe(short);
    // Exactly six hours IS long enough.
    const atSix = splitOvertime(
      [{ workDate: '2026-03-01', workingMinutes: BREAK_AFTER_MINUTES }],
      rules({ breakMinutes: 60 }, ['2026-03-01']),
    );
    expect(atSix.offDayMinutes).toBe(BREAK_AFTER_MINUTES - 60);
  });

  it('a depot that pays its break sets 0 and is left exactly as it was', () => {
    const day = [{ workDate: '2026-03-02', workingMinutes: 600 }];
    expect(splitOvertime(day, rules({ breakMinutes: 0 })).regularMinutes).toBe(120);
  });

  it('never pays negative minutes when the break is longer than the day', () => {
    const out = splitOvertime(
      [{ workDate: '2026-03-01', workingMinutes: 400 }],
      rules({ breakMinutes: 999 }, ['2026-03-01']),
    );
    expect(out.totalMinutes).toBe(0);
  });
});

describe('minuteRate', () => {
  it('spreads a monthly wage over expected working days and the standard shift', () => {
    // 4,800,000 over 20 days × 480 minutes = 500/minute.
    expect(minuteRate('MONTHLY', 4_800_000, 0, 20, STANDARD)).toBe(500);
  });

  it('spreads a daily wage over one standard shift', () => {
    expect(minuteRate('DAILY', 0, 96_000, 20, STANDARD)).toBe(200);
  });

  it('pays nothing rather than infinity when the divisor is missing', () => {
    expect(minuteRate('MONTHLY', 4_800_000, 0, 0, STANDARD)).toBe(0);
    expect(minuteRate('MONTHLY', 4_800_000, 0, 20, 0)).toBe(0);
    expect(minuteRate('DAILY', 0, 96_000, 20, 0)).toBe(0);
  });
});

describe('overtimePay', () => {
  const breakdown = { regularMinutes: 120, offDayMinutes: 60, totalMinutes: 180 };

  it('applies each multiplier to its own bucket', () => {
    // 120 × 500 × 1.5 = 90000; 60 × 500 × 2 = 60000.
    expect(overtimePay(breakdown, 500, { multiplier: 1.5, offDayMultiplier: 2 })).toBe(150_000);
  });

  it('a zero ordinary multiplier switches ordinary overtime off but keeps off-day pay', () => {
    expect(overtimePay(breakdown, 500, { multiplier: 0, offDayMultiplier: 2 })).toBe(60_000);
  });

  it('pays nothing when the rate is unknown', () => {
    expect(overtimePay(breakdown, 0, { multiplier: 1.5, offDayMultiplier: 2 })).toBe(0);
  });
});

describe('formatMinutes', () => {
  it('renders hours and minutes for the slip line', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2j');
    expect(formatMinutes(150)).toBe('2j 30m');
  });
});
