import { toUtcDay, addDays, denseDailySeries } from '../../src/domain/series';
import { movingAverage } from '../../src/domain/moving-average';
import { linearTrend, projectAt } from '../../src/domain/trend';
import { clampNonNeg, forecastDemand } from '../../src/domain/forecast';

describe('series', () => {
  it('toUtcDay/addDays are consistent epoch-day math', () => {
    const d0 = toUtcDay(new Date('2026-07-11T00:00:00Z'));
    const d1 = toUtcDay(new Date('2026-07-12T23:59:59Z'));
    expect(d1 - d0).toBe(1);
    expect(addDays(d0, 3)).toBe(d0 + 3);
  });
  it('fills gaps with 0 and preserves length + order', () => {
    const rows = [
      { day: 100, quantity: 5 },
      { day: 102, quantity: 2 },
    ];
    expect(denseDailySeries(rows, { fromDay: 100, toDay: 103 })).toEqual([5, 0, 2, 0]);
  });
  it('sums duplicate-day rows', () => {
    const rows = [
      { day: 100, quantity: 3 },
      { day: 100, quantity: 4 },
    ];
    expect(denseDailySeries(rows, { fromDay: 100, toDay: 100 })).toEqual([7]);
  });
  it('empty rows -> all zeros of correct length', () => {
    expect(denseDailySeries([], { fromDay: 100, toDay: 104 })).toEqual([0, 0, 0, 0, 0]);
  });
  it('toDay < fromDay -> []', () => {
    expect(denseDailySeries([{ day: 100, quantity: 1 }], { fromDay: 100, toDay: 99 })).toEqual([]);
  });
});

describe('movingAverage', () => {
  it('empty series -> 0', () => {
    expect(movingAverage([], 5)).toBe(0);
  });
  it('partial window (series shorter than window) averages all', () => {
    expect(movingAverage([2, 4], 5)).toBe(3);
  });
  it('full window uses only the last window values', () => {
    expect(movingAverage([100, 2, 4, 6], 3)).toBe(4);
  });
  it('window<=0 -> full-series average', () => {
    expect(movingAverage([1, 2, 3, 4], 0)).toBe(2.5);
  });
});

describe('linearTrend', () => {
  it('strictly rising -> slope > 0', () => {
    expect(linearTrend([1, 2, 3, 4]).slope).toBeGreaterThan(0);
  });
  it('strictly falling -> slope < 0', () => {
    expect(linearTrend([4, 3, 2, 1]).slope).toBeLessThan(0);
  });
  it('flat series -> slope 0', () => {
    expect(linearTrend([5, 5, 5]).slope).toBe(0);
  });
  it('single point -> slope 0, intercept = value', () => {
    expect(linearTrend([7])).toEqual({ slope: 0, intercept: 7 });
  });
  it('empty -> slope 0, intercept 0', () => {
    expect(linearTrend([])).toEqual({ slope: 0, intercept: 0 });
  });
  it('projectAt applies intercept + slope*index', () => {
    expect(projectAt({ slope: 2, intercept: 1 }, 3)).toBe(7);
  });
});

describe('forecastDemand', () => {
  it('rising history projects an increasing, positive series', () => {
    const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const f = forecastDemand(series, { horizonDays: 5, maWindow: 3 });
    expect(f.predictedDaily).toHaveLength(5);
    expect(f.predictedDaily.every((v) => v > 0)).toBe(true);
    expect(f.predictedDaily[4]).toBeGreaterThan(f.predictedDaily[0]);
    expect(f.trendSlope).toBeGreaterThan(0);
    expect(f.predictedTotal).toBe(f.predictedDaily.reduce((a, b) => a + b, 0));
    expect(f.reorderSuggestion).toBe(f.predictedTotal);
  });
  it('empty series -> all-zero predictedDaily of length horizon, total 0', () => {
    const f = forecastDemand([], { horizonDays: 4, maWindow: 7 });
    expect(f.predictedDaily).toEqual([0, 0, 0, 0]);
    expect(f.predictedTotal).toBe(0);
    expect(f.reorderSuggestion).toBe(0);
  });
  it('horizonDays <= 0 -> []', () => {
    expect(forecastDemand([1, 2, 3], { horizonDays: 0, maWindow: 3 }).predictedDaily).toEqual([]);
  });
  it('every predicted entry is a non-negative integer', () => {
    const f = forecastDemand([3, 1, 4, 1, 5, 9, 2, 6], { horizonDays: 6, maWindow: 4 });
    for (const v of f.predictedDaily) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
  it('short history blends toward avgDaily where pure projection would go negative', () => {
    // n=5 < maWindow*2=20 -> blend on. slope=-2, intercept=10, avgDaily=6.
    // pure proj at index 6 = 10-2*6 = -2 -> clamped 0; blend = 0.5*(-2)+0.5*6 = 2.
    const series = [10, 8, 6, 4, 2];
    const f = forecastDemand(series, { horizonDays: 2, maWindow: 10 });
    expect(f.trendSlope).toBeLessThan(0);
    expect(f.avgDaily).toBe(6);
    expect(f.predictedDaily[1]).toBe(2); // blend keeps it positive vs 0 under pure projection
  });
  it('clampNonNeg floors at 0', () => {
    expect(clampNonNeg(-3)).toBe(0);
    expect(clampNonNeg(5)).toBe(5);
  });
});
