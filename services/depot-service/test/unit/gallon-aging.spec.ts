import { ageOutstanding } from '../../src/domain/gallon-aging';

const NOW = new Date('2026-09-28T05:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const issue = (quantity: number, ago: number) => ({ quantity, createdAt: daysAgo(ago) });

describe('ageOutstanding', () => {
  it('has no age and nothing overdue when no gallon is out', () => {
    expect(ageOutstanding([issue(2, 40)], 0, NOW, 14)).toEqual({ overdue: 0, oldestIssuedAt: null });
    expect(ageOutstanding([], 0, NOW, 14)).toEqual({ overdue: 0, oldestIssuedAt: null });
  });

  it('counts gallons held longer than the limit as overdue, and names the oldest', () => {
    const oldest = daysAgo(30);
    const aging = ageOutstanding([issue(1, 3), { quantity: 2, createdAt: oldest }], 3, NOW, 14);
    expect(aging).toEqual({ overdue: 2, oldestIssuedAt: oldest });
  });

  it('does not count a gallon held for exactly the limit — overdue means MORE than', () => {
    expect(ageOutstanding([issue(2, 14)], 2, NOW, 14).overdue).toBe(0);
    expect(ageOutstanding([issue(2, 15)], 2, NOW, 14).overdue).toBe(2);
  });

  // Returns settle the OLDEST debt first. Two gallons taken long ago plus one taken yesterday,
  // two handed back: the two old ones are settled, so what is still out is yesterday's.
  // Reading it the other way round would put a customer who returned their old gallons on a
  // reminder list for a gallon they picked up yesterday.
  it('reads the gallons still out as the MOST RECENT issues, because returns clear the oldest', () => {
    // 3 issued in total (2 long ago, 1 yesterday), 2 returned -> 1 still out: yesterday's.
    const aging = ageOutstanding([issue(1, 1), issue(2, 200)], 1, NOW, 14);
    expect(aging.overdue).toBe(0);
    expect(aging.oldestIssuedAt).toEqual(daysAgo(1));
  });

  it('splits one issue: only the gallons actually still out count', () => {
    // One issue of 5 long ago, 3 returned -> 2 still out, all from that old issue.
    expect(ageOutstanding([issue(5, 60)], 2, NOW, 14).overdue).toBe(2);
  });

  it('stops walking once every gallon still out is placed', () => {
    const rows = [issue(1, 2), issue(1, 90), issue(1, 91)];
    // Only 1 out -> the newest row settles it; the 90-day rows must not be reached.
    const aging = ageOutstanding(rows, 1, NOW, 14);
    expect(aging).toEqual({ overdue: 0, oldestIssuedAt: daysAgo(2) });
  });

  it('never goes negative when returns exceed issues', () => {
    expect(ageOutstanding([issue(1, 30)], -3, NOW, 14)).toEqual({ overdue: 0, oldestIssuedAt: null });
  });

  it('when the fetched rows run out before the gallons do, counts the remainder only if the oldest row seen is already overdue', () => {
    // 5 out but the capped fetch saw only 2: the other 3 are older than the 40-day row.
    expect(ageOutstanding([issue(2, 40)], 5, NOW, 14).overdue).toBe(5);
    // The oldest row seen is recent, so nothing can be said about the rest — not flagged.
    expect(ageOutstanding([issue(2, 3)], 5, NOW, 14).overdue).toBe(0);
    // No rows at all: nothing to judge by.
    expect(ageOutstanding([], 5, NOW, 14)).toEqual({ overdue: 0, oldestIssuedAt: null });
  });

  it('respects a longer limit', () => {
    expect(ageOutstanding([issue(2, 30)], 2, NOW, 45).overdue).toBe(0);
    expect(ageOutstanding([issue(2, 50)], 2, NOW, 45).overdue).toBe(2);
  });
});
