import { parseWeeklyOffDays, workingDaysInMonth } from '../../src/domain/calendar';

describe('workingDaysInMonth', () => {
  it('counts every day when there are no holidays or weekly-off days', () => {
    expect(workingDaysInMonth(2026, 7, new Set(), new Set())).toBe(31); // July has 31 days
  });

  it('excludes dated holidays', () => {
    const holidays = new Set(['2026-07-01', '2026-07-17']);
    expect(workingDaysInMonth(2026, 7, holidays, new Set())).toBe(29);
  });

  it('excludes weekly-off weekdays (Sundays in July 2026: 5, 12, 19, 26)', () => {
    expect(workingDaysInMonth(2026, 7, new Set(), new Set([0]))).toBe(31 - 4);
  });

  it('does not double-count a holiday that also lands on a weekly-off day', () => {
    // 2026-07-05 is a Sunday; excluding both Sundays and that date must not subtract twice.
    expect(workingDaysInMonth(2026, 7, new Set(['2026-07-05']), new Set([0]))).toBe(31 - 4);
  });
});

describe('parseWeeklyOffDays', () => {
  it('parses a CSV of weekday indices, ignoring blanks and out-of-range', () => {
    expect([...parseWeeklyOffDays('0, 6, 9, ')]).toEqual([0, 6]);
  });
  it('returns an empty set for an empty string', () => {
    expect(parseWeeklyOffDays('').size).toBe(0);
  });
});
