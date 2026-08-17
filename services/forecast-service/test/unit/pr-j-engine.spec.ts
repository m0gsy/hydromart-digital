import { buildDataset, FEATURE_NAMES, splitByTime, WEEKEND_DAYS } from '../../src/domain/dataset';
import { backtest, compare } from '../../src/domain/evaluate';
import { baselineModel, DEFAULT_MODEL, heuristicModel, MODELS, resolveModel } from '../../src/domain/models';

describe('PR-J: the machinery, before any fit', () => {
  describe('buildDataset', () => {
    const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    it('emits one row per predictable day and no rows for the warm-up window', () => {
      const rows = buildDataset(series, { startDay: 100, lookback: 3 });
      expect(rows).toHaveLength(series.length - 3);
      expect(rows[0].day).toBe(103);
      expect(rows.at(-1)?.day).toBe(109);
    });

    it('never reads a value at or after its own label — the leak that flatters an offline score', () => {
      const rows = buildDataset(series, { startDay: 0, lookback: 3 });
      for (const row of rows) {
        expect(row.features.every((f) => f < row.label || row.label === 0 || f <= Math.max(...series))).toBe(true);
      }
      // Row 0 predicts series[3]=4 from [1,2,3]: the label itself appears in no feature.
      expect(rows[0].label).toBe(4);
      expect(rows[0].features.slice(0, 4)).toEqual([3, 2, 1, 0]);
    });

    it('produces one feature per declared name, in that order', () => {
      const [row] = buildDataset(series, { startDay: 0, lookback: 4 });
      expect(row.features).toHaveLength(FEATURE_NAMES.length);
    });

    it('carries window mean, slope and density', () => {
      const [row] = buildDataset([0, 0, 4, 8], { startDay: 0, lookback: 3 });
      const [, , , , windowMean, windowSlope, nonZeroShare] = row.features;
      expect(windowMean).toBeCloseTo(4 / 3);
      expect(windowSlope).toBeCloseTo(2);
      expect(nonZeroShare).toBeCloseTo(1 / 3);
    });

    it('flags the weekend by business-day number, defaults included', () => {
      const weekendRow = buildDataset([1, 1, 1, 1], { startDay: WEEKEND_DAYS[0] - 3, lookback: 3 })[0];
      expect(weekendRow.features.at(-1)).toBe(1);
      const weekdayRow = buildDataset([1, 1, 1, 1], { startDay: 0, lookback: 3 })[0];
      expect(weekdayRow.features.at(-1)).toBe(0);
    });

    it('normalises a negative day number instead of producing a negative weekday index', () => {
      // day -7: JS `%` gives -0, so a naive `day % 7` would never match a weekend index.
      const rows = buildDataset([1, 1, 1, 1], { startDay: -10, lookback: 3, weekendDays: [0] });
      expect(rows[0].day).toBe(-7);
      expect(rows[0].features.at(-1)).toBe(1);
    });

    it('refuses a lookback below one rather than emitting an empty window', () => {
      const rows = buildDataset([1, 2, 3], { startDay: 0, lookback: 0 });
      expect(rows).toHaveLength(2);
      expect(rows[0].features[4]).toBe(1); // window mean of [1]
    });

    it('returns nothing when the series is shorter than the lookback', () => {
      expect(buildDataset([1, 2], { startDay: 0, lookback: 7 })).toEqual([]);
    });

    it('defaults the lookback to a week', () => {
      expect(buildDataset(new Array(10).fill(1), { startDay: 0 })).toHaveLength(3);
    });
  });

  describe('splitByTime', () => {
    const rows = buildDataset([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { startDay: 0, lookback: 1 });

    it('splits chronologically, never at random', () => {
      const { train, test } = splitByTime(rows, 0.7);
      expect(train.at(-1)!.day).toBeLessThan(test[0].day);
      expect(train.length + test.length).toBe(rows.length);
    });

    it('clamps a nonsense share instead of producing a negative slice', () => {
      expect(splitByTime(rows, -1).train).toEqual([]);
      expect(splitByTime(rows, 5).test).toEqual([]);
    });

    it('defaults to 70/30', () => {
      expect(splitByTime(rows).train).toHaveLength(Math.floor(rows.length * 0.7));
    });
  });

  describe('models', () => {
    it('keeps the heuristic as the default', () => {
      expect(DEFAULT_MODEL).toBe('heuristic');
      expect(resolveModel(undefined)).toBe(heuristicModel);
      expect(resolveModel(null)).toBe(heuristicModel);
    });

    it('resolves a typo to the default rather than throwing on a request path', () => {
      expect(resolveModel('movingaverage')).toBe(heuristicModel);
    });

    it('resolves every registered name', () => {
      for (const model of MODELS) expect(resolveModel(model.name)).toBe(model);
    });

    it('predicts a flat horizon from the average, with no trend', () => {
      const f = baselineModel.predict([10, 10, 10, 20], { horizonDays: 3, maWindow: 4 });
      expect(f.predictedDaily).toEqual([13, 13, 13]);
      expect(f.trendSlope).toBe(0);
      expect(f.predictedTotal).toBe(39);
      expect(f.reorderSuggestion).toBe(39);
      expect(f.confidence).toBeGreaterThan(0);
    });

    it('never predicts negative demand from a falling series', () => {
      const f = baselineModel.predict([0, 0, 0], { horizonDays: 2, maWindow: 3 });
      expect(f.predictedDaily).toEqual([0, 0]);
    });
  });

  describe('backtest', () => {
    it('scores only the days after the warm-up window', () => {
      const m = backtest([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], baselineModel, { minTrain: 7 });
      expect(m.n).toBe(3);
      expect(m.model).toBe('moving-average');
    });

    it('reports a signed bias, so under- and over-forecasting are distinguishable', () => {
      // A flat 10 series with a step down: the average keeps over-forecasting.
      const m = backtest([10, 10, 10, 10, 10, 10, 10, 2, 2, 2], baselineModel, { minTrain: 7 });
      expect(m.bias).toBeGreaterThan(0);
      expect(m.mae).toBeGreaterThan(0);
    });

    it('excludes zero-demand days from MAPE and counts them instead of calling them 0% error', () => {
      const m = backtest([5, 5, 5, 5, 5, 5, 5, 0, 0, 5], baselineModel, { minTrain: 7 });
      expect(m.zeroDays).toBe(2);
      expect(m.mape).not.toBeNull();
    });

    it('returns nulls and zeroes rather than NaN when there is nothing to score', () => {
      const m = backtest([1, 2, 3], baselineModel, { minTrain: 7 });
      expect(m).toMatchObject({ n: 0, mae: 0, mape: null, bias: 0 });
    });

    it('reports no MAPE at all when every scored day sold nothing', () => {
      expect(backtest([0, 0, 0, 0, 0, 0, 0, 0, 0], baselineModel, { minTrain: 7 }).mape).toBeNull();
    });

    it('defaults its window and warm-up', () => {
      expect(backtest(new Array(12).fill(3), baselineModel).n).toBe(5);
    });

    it('clamps nonsense options instead of trusting them', () => {
      expect(backtest(new Array(12).fill(3), baselineModel, { minTrain: 0, maWindow: 0 }).n).toBe(11);
    });
  });

  describe('compare', () => {
    const series = [4, 6, 5, 7, 6, 8, 7, 9, 8, 10, 9, 11, 10, 12];

    it('states the delta so that negative means better', () => {
      const result = compare(series, baselineModel, [heuristicModel], { minTrain: 7 });
      expect(result.baseline.model).toBe('moving-average');
      expect(result.candidates).toHaveLength(1);
      const [candidate] = result.candidates;
      expect(candidate.maeDeltaPct).toBeCloseTo(((candidate.mae - result.baseline.mae) / result.baseline.mae) * 100, 1);
    });

    it('finds the trend-aware model better than a flat average on a trending series', () => {
      const [candidate] = compare(series, baselineModel, [heuristicModel], { minTrain: 7 }).candidates;
      expect(candidate.maeDeltaPct).toBeLessThan(0);
    });

    it('does not divide by a zero baseline error', () => {
      const flat = new Array(14).fill(5);
      const [candidate] = compare(flat, baselineModel, [heuristicModel], { minTrain: 7 }).candidates;
      expect(candidate.maeDeltaPct).toBe(0);
    });

    it('runs with default options', () => {
      expect(compare(series, baselineModel, []).candidates).toEqual([]);
    });
  });
});
