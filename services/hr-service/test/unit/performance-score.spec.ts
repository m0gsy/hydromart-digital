import {
  DEFAULT_SCORE_WEIGHTS,
  attendanceScore,
  computePerformanceScore,
  disciplineScore,
  salesScore,
} from '../../src/domain/performance-score';

const inputs = (over: Partial<Parameters<typeof computePerformanceScore>[0]> = {}) => ({
  presentDays: 20,
  lateDays: 0,
  workingDays: 20,
  salesTotal: null,
  salesTarget: 0,
  ...over,
});

describe('performance components (C2)', () => {
  it('attendance is the share of scheduled days actually attended', () => {
    expect(attendanceScore(20, 20)).toBe(100);
    expect(attendanceScore(15, 20)).toBe(75);
    expect(attendanceScore(0, 20)).toBe(0);
    // Working overtime on a day off cannot push it past 100.
    expect(attendanceScore(25, 20)).toBe(100);
  });

  it('attendance is UNMEASURABLE, not zero, when nothing was scheduled', () => {
    expect(attendanceScore(0, 0)).toBeNull();
    expect(attendanceScore(5, -1)).toBeNull();
  });

  it('discipline measures lateness against days attended, not days scheduled', () => {
    // Being absent already costs attendance; counting it here would charge it twice.
    expect(disciplineScore(20, 0)).toBe(100);
    expect(disciplineScore(20, 5)).toBe(75);
    expect(disciplineScore(20, 20)).toBe(0);
    expect(disciplineScore(0, 0)).toBeNull();
  });

  it('sales scores attainment, capped, and is unmeasurable without a figure or a target', () => {
    expect(salesScore(50_000_000, 100_000_000)).toBe(50);
    expect(salesScore(300_000_000, 100_000_000)).toBe(100);
    expect(salesScore(null, 100_000_000)).toBeNull();
    expect(salesScore(50_000_000, 0)).toBeNull();
  });
});

describe('performance score (C2)', () => {
  it('weights the three components on the default 40/30/30', () => {
    const out = computePerformanceScore(
      inputs({ presentDays: 20, lateDays: 4, salesTotal: 60, salesTarget: 100 }),
    );
    expect(out).toMatchObject({ attendance: 100, discipline: 80, sales: 60 });
    expect(out.final).toBe(82); // (100*40 + 80*30 + 60*30) / 100
    expect(out.effectiveWeights).toEqual(DEFAULT_SCORE_WEIGHTS);
  });

  it('renormalises when a component cannot be measured instead of scoring it zero', () => {
    const noSales = computePerformanceScore(inputs({ presentDays: 20, lateDays: 4 }));
    // Scoring the missing sales as 0 would give 70; the honest answer weighs only 40/30.
    expect(noSales.final).toBeCloseTo(91.43, 2);
    expect(noSales.effectiveWeights).toEqual({ attendance: 40, discipline: 30, sales: 0 });
  });

  it('returns a null final when nothing at all was measurable', () => {
    const out = computePerformanceScore(inputs({ presentDays: 0, workingDays: 0 }));
    expect(out).toMatchObject({ attendance: null, discipline: null, sales: null, final: null });
  });

  it('returns a null final when every configured weight is zero', () => {
    const out = computePerformanceScore(inputs(), { attendance: 0, discipline: 0, sales: 0 });
    expect(out.attendance).toBe(100);
    expect(out.final).toBeNull();
  });

  it('honours a single-component weighting', () => {
    const out = computePerformanceScore(inputs({ presentDays: 10, lateDays: 5 }), {
      attendance: 0,
      discipline: 100,
      sales: 0,
    });
    expect(out.final).toBe(50);
  });

  it('treats a negative weight as unset rather than letting it subtract', () => {
    const out = computePerformanceScore(inputs({ presentDays: 10, lateDays: 0 }), {
      attendance: -50,
      discipline: 30,
      sales: 0,
    });
    expect(out.effectiveWeights.attendance).toBe(0);
    expect(out.final).toBe(100); // discipline alone
  });

  it('rounds to two decimals rather than trailing float noise', () => {
    const out = computePerformanceScore(inputs({ presentDays: 1, workingDays: 3, lateDays: 0 }));
    expect(out.attendance).toBe(33.33);
    expect(Number.isFinite(out.final!)).toBe(true);
  });
});
