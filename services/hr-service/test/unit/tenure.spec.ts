import {
  annualLeaveQuotaFor,
  parseRaiseLadder,
  tenureMonths,
  tenureRaisePercent,
  tenureYears,
  thrAmount,
} from '../../src/domain/tenure';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('tenureYears', () => {
  it('counts completed years, anniversary reached', () => {
    expect(tenureYears(d('2024-03-10'), d('2026-03-10'))).toBe(2);
  });
  it('does not count the year until the anniversary day', () => {
    expect(tenureYears(d('2024-03-10'), d('2026-03-09'))).toBe(1);
  });
  it('is 0 for same day and for a future join date', () => {
    expect(tenureYears(d('2026-03-10'), d('2026-03-10'))).toBe(0);
    expect(tenureYears(d('2026-06-01'), d('2026-03-10'))).toBe(0);
  });
});

describe('parseRaiseLadder', () => {
  it('parses "y:p" pairs sorted ascending by years', () => {
    expect(parseRaiseLadder('3:15, 1:5, 2:10')).toEqual([
      { years: 1, pct: 5 },
      { years: 2, pct: 10 },
      { years: 3, pct: 15 },
    ]);
  });
  it('drops blanks and malformed/negative entries; "" → []', () => {
    expect(parseRaiseLadder('')).toEqual([]);
    expect(parseRaiseLadder('1:5, x:9, 2:-3, :7, 4')).toEqual([{ years: 1, pct: 5 }]);
  });
});

describe('tenureRaisePercent', () => {
  const ladder = parseRaiseLadder('1:5,2:10,3:15');
  it('returns the highest step whose year requirement is met', () => {
    expect(tenureRaisePercent(ladder, 0)).toBe(0);
    expect(tenureRaisePercent(ladder, 1)).toBe(5);
    expect(tenureRaisePercent(ladder, 2)).toBe(10);
    expect(tenureRaisePercent(ladder, 5)).toBe(15); // caps at the top step
  });
  it('returns 0 for an empty ladder', () => {
    expect(tenureRaisePercent([], 10)).toBe(0);
  });
});

describe('tenureMonths', () => {
  it('turns the month only once the day-of-month is reached', () => {
    expect(tenureMonths(d('2026-03-15'), d('2026-04-14'))).toBe(0);
    expect(tenureMonths(d('2026-03-15'), d('2026-04-15'))).toBe(1);
    expect(tenureMonths(d('2025-03-15'), d('2026-04-15'))).toBe(13);
  });
  it('is 0 for a future join date', () => {
    expect(tenureMonths(d('2026-06-01'), d('2026-03-10'))).toBe(0);
  });
});

describe('annualLeaveQuotaFor', () => {
  it('prorates the joining year, floored', () => {
    expect(annualLeaveQuotaFor(12, d('2026-11-01'), 2026)).toBe(2); // Nov + Dec
    expect(annualLeaveQuotaFor(12, d('2026-03-15'), 2026)).toBe(9); // 15 Mar → 1 Jan = 9 months
    expect(annualLeaveQuotaFor(12, d('2026-12-20'), 2026)).toBe(0); // under a month
  });
  it('gives a January joiner the whole first year', () => {
    expect(annualLeaveQuotaFor(12, d('2026-01-01'), 2026)).toBe(12);
  });
  it('floors rather than rounds against a non-12 depot quota', () => {
    expect(annualLeaveQuotaFor(15, d('2026-08-01'), 2026)).toBe(6); // 5/12 × 15 = 6.25
  });
  it('pays the full quota in every year after the joining year, and nothing before it', () => {
    expect(annualLeaveQuotaFor(12, d('2026-11-01'), 2027)).toBe(12);
    expect(annualLeaveQuotaFor(12, d('2026-11-01'), 2025)).toBe(0);
  });
});

describe('thrAmount', () => {
  it('pays a whole month at twelve months or more', () => {
    expect(thrAmount(3_000_000, 12)).toBe(3_000_000);
    expect(thrAmount(3_000_000, 40)).toBe(3_000_000);
  });
  it('prorates one to eleven months', () => {
    expect(thrAmount(3_000_000, 1)).toBe(250_000);
    expect(thrAmount(3_000_000, 11)).toBe(2_750_000);
  });
  it('pays nothing under a month, and nothing on a zero wage', () => {
    expect(thrAmount(3_000_000, 0)).toBe(0);
    expect(thrAmount(0, 12)).toBe(0);
  });
});
