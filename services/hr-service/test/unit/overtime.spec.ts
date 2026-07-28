import { formatMinutes, minuteRate, overtimePay, splitOvertime } from '../../src/domain/overtime';

const STANDARD = 480; // 8h

describe('splitOvertime', () => {
  const noOffDays = () => false;

  it('counts only the minutes above the standard shift on an ordinary day', () => {
    const out = splitOvertime(
      [{ workDate: '2026-03-02', workingMinutes: 600 }],
      STANDARD,
      noOffDays,
    );
    expect(out).toEqual({ regularMinutes: 120, offDayMinutes: 0, totalMinutes: 120 });
  });

  it('counts every worked minute on a weekly-off day or national holiday (M24-17)', () => {
    const out = splitOvertime(
      [
        { workDate: '2026-03-01', workingMinutes: 300 }, // off day
        { workDate: '2026-03-02', workingMinutes: 300 }, // ordinary, under standard
      ],
      STANDARD,
      (d) => d === '2026-03-01',
    );
    expect(out).toEqual({ regularMinutes: 0, offDayMinutes: 300, totalMinutes: 300 });
  });

  it('treats a holiday exactly like a weekly-off day', () => {
    const holiday = splitOvertime(
      [{ workDate: '2026-03-20', workingMinutes: 240 }],
      STANDARD,
      (d) => d === '2026-03-20',
    );
    const weeklyOff = splitOvertime(
      [{ workDate: '2026-03-01', workingMinutes: 240 }],
      STANDARD,
      (d) => d === '2026-03-01',
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
      STANDARD,
      noOffDays,
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
