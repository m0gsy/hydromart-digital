import { scoreReorder, rankReorder } from '../../src/domain/reorder';
import { confidence, rankRelated } from '../../src/domain/co-buy';
import { rankTrending } from '../../src/domain/trending';

const now = new Date('2026-07-11T00:00:00Z');

describe('reorder', () => {
  it('scoreReorder applies recency decay', () => {
    const row = { productId: 'p1', purchaseCount: 10, lastPurchasedAt: new Date('2026-07-10T00:00:00Z') };
    const score = scoreReorder(row, now);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(10);
  });
  it('ranks frequent+recent above rare+old', () => {
    const rows = [
      { productId: 'a', purchaseCount: 10, lastPurchasedAt: new Date('2026-07-10T00:00:00Z') },
      { productId: 'b', purchaseCount: 1, lastPurchasedAt: new Date('2026-01-01T00:00:00Z') },
    ];
    expect(rankReorder(rows, now, 10).map((r) => r.productId)).toEqual(['a', 'b']);
  });
  it('recency breaks a frequency tie', () => {
    const rows = [
      { productId: 'old', purchaseCount: 5, lastPurchasedAt: new Date('2026-01-01T00:00:00Z') },
      { productId: 'new', purchaseCount: 5, lastPurchasedAt: new Date('2026-07-10T00:00:00Z') },
    ];
    expect(rankReorder(rows, now, 10)[0].productId).toBe('new');
  });
  it('honors limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ productId: `p${i}`, purchaseCount: i + 1, lastPurchasedAt: now }));
    expect(rankReorder(rows, now, 2)).toHaveLength(2);
  });
});

describe('co-buy', () => {
  it('confidence is co/base, 0 when base 0', () => {
    expect(confidence(3, 6)).toBeCloseTo(0.5);
    expect(confidence(3, 0)).toBe(0);
  });
  it('ranks by confidence then coCount', () => {
    const rows = [
      { relatedProductId: 'x', coCount: 2 },
      { relatedProductId: 'y', coCount: 5 },
    ];
    expect(rankRelated(rows, 10, 10).map((r) => r.productId)).toEqual(['y', 'x']);
  });
});

describe('trending', () => {
  const from = new Date('2026-07-01T00:00:00Z');
  it('sums in-window per product and ranks desc', () => {
    const rows = [
      { productId: 'a', day: new Date('2026-07-02'), count: 3 },
      { productId: 'a', day: new Date('2026-07-05'), count: 4 },
      { productId: 'b', day: new Date('2026-07-03'), count: 5 },
    ];
    expect(rankTrending(rows, from, 10).map((r) => r.productId)).toEqual(['a', 'b']);
  });
  it('excludes rows before fromDay', () => {
    const rows = [
      { productId: 'a', day: new Date('2026-06-01'), count: 100 },
      { productId: 'b', day: new Date('2026-07-02'), count: 1 },
    ];
    expect(rankTrending(rows, from, 10).map((r) => r.productId)).toEqual(['b']);
  });
});
