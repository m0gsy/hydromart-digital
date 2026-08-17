import { DemandModel } from './models';

/**
 * PR-J, part three: the offline harness. Walk-forward backtest — train on everything up to
 * day D, predict D+1, step, repeat — which is the only evaluation whose numbers a live
 * forecast can actually reproduce.
 *
 * It reports three things, and the third is the one that gets forgotten:
 *   MAE   how far off, in galon, on an average day.
 *   MAPE  the same as a percentage, so depots of different sizes compare — undefined on
 *         zero-demand days, which are common here, so those days are counted and excluded
 *         rather than silently treated as 0% error.
 *   bias  signed. A model that is 5 short every day and one that alternates ±5 have the
 *         same MAE and completely different consequences for a depot's stock.
 */

export interface BacktestMetrics {
  model: string;
  /** Days actually scored (the warm-up window is not). */
  n: number;
  mae: number;
  /** Mean absolute percentage error over the days where actual > 0. */
  mape: number | null;
  /** Days skipped by MAPE because nothing sold. */
  zeroDays: number;
  /** Mean signed error: positive = the model over-forecasts. */
  bias: number;
}

export interface BacktestOptions {
  /** Days of history the first prediction may use. */
  minTrain?: number;
  maWindow?: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * One model over one series. The horizon is deliberately ONE day: a multi-day horizon
 * scores the same model against overlapping windows and quietly weights the middle of the
 * series highest. Reorder decisions are made off the total, but a model that cannot get
 * tomorrow right does not get the week right either.
 */
export function backtest(
  series: number[],
  model: DemandModel,
  options: BacktestOptions = {},
): BacktestMetrics {
  const minTrain = Math.max(1, options.minTrain ?? 7);
  const maWindow = Math.max(1, options.maWindow ?? 7);
  let absolute = 0;
  let signed = 0;
  let percentSum = 0;
  let scored = 0;
  let percentDays = 0;
  let zeroDays = 0;

  for (let i = minTrain; i < series.length; i++) {
    const history = series.slice(0, i);
    // horizonDays is 1, so every model returns exactly one day; a fallback here would be
    // an unreachable branch pretending to be caution.
    const predicted = model.predict(history, { horizonDays: 1, maWindow }).predictedDaily[0];
    const actual = series[i];
    const error = predicted - actual;
    absolute += Math.abs(error);
    signed += error;
    scored += 1;
    if (actual > 0) {
      percentSum += Math.abs(error) / actual;
      percentDays += 1;
    } else {
      zeroDays += 1;
    }
  }

  return {
    model: model.name,
    n: scored,
    mae: scored ? round(absolute / scored) : 0,
    mape: percentDays ? round((percentSum / percentDays) * 100) : null,
    zeroDays,
    bias: scored ? round(signed / scored) : 0,
  };
}

export interface Comparison {
  baseline: BacktestMetrics;
  candidates: (BacktestMetrics & { maeDeltaPct: number })[];
}

/**
 * Every candidate against the baseline, on the same series and the same split.
 * `maeDeltaPct` is negative when the candidate is BETTER — the sign that matters is "did
 * the error go down", and stating it once here stops every reader deriving it differently.
 */
export function compare(
  series: number[],
  baseline: DemandModel,
  candidates: DemandModel[],
  options: BacktestOptions = {},
): Comparison {
  const base = backtest(series, baseline, options);
  return {
    baseline: base,
    candidates: candidates.map((model) => {
      const metrics = backtest(series, model, options);
      return {
        ...metrics,
        maeDeltaPct: base.mae === 0 ? 0 : round(((metrics.mae - base.mae) / base.mae) * 100),
      };
    }),
  };
}
