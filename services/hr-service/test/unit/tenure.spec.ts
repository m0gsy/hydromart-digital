import { parseRaiseLadder, tenureRaisePercent, tenureYears } from '../../src/domain/tenure';

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
