import { Forecast, forecastConfidence, forecastDemand } from './forecast';
import { movingAverage } from './moving-average';

/**
 * PR-J, part two: the seam a fitted model swaps into, and the two forecasters that exist
 * today on either side of it.
 *
 * `forecast.service.ts` used to call `forecastDemand` directly, with a comment promising
 * this seam. A comment is not a seam: nothing could be measured against the heuristic
 * because nothing else could be run in its place. Now a model is a name, the name comes
 * from a setting, and the setting is per depot — so a candidate can be turned on for one
 * depot, measured against the depot next door, and turned off again without a deploy.
 *
 * The default is, and stays, the heuristic.
 */

export interface ForecastInput {
  horizonDays: number;
  maWindow: number;
}

export interface DemandModel {
  readonly name: string;
  /** Why this one exists — read by the eval harness so its table explains itself. */
  readonly description: string;
  predict(series: number[], input: ForecastInput): Forecast;
}

/**
 * The BASELINE, and the only honest thing to measure anything else against: tomorrow looks
 * like the recent average, for every day of the horizon. No trend, no blending. If a
 * cleverer model cannot beat this, the cleverness is decoration.
 */
export const baselineModel: DemandModel = {
  name: 'moving-average',
  description: 'Flat moving average over the window. The number to beat.',
  predict(series, input) {
    const avgDaily = movingAverage(series, input.maWindow);
    const day = Math.max(0, Math.round(avgDaily));
    const predictedDaily = Array.from({ length: input.horizonDays }, () => day);
    const predictedTotal = predictedDaily.reduce((a, b) => a + b, 0);
    return {
      avgDaily,
      trendSlope: 0,
      predictedDaily,
      predictedTotal,
      reorderSuggestion: predictedTotal,
      confidence: forecastConfidence(series),
    };
  },
};

/** What production has always done: moving-average level plus a linear trend projection. */
export const heuristicModel: DemandModel = {
  name: 'heuristic',
  description: 'Moving average + linear trend, blended toward the mean on short history.',
  predict: (series, input) => forecastDemand(series, input),
};

export const MODELS: readonly DemandModel[] = [heuristicModel, baselineModel];

export const DEFAULT_MODEL = heuristicModel.name;

/**
 * A name that is not a model resolves to the default rather than throwing. This is read
 * from configuration on a request path: a typo in a per-depot setting must degrade to the
 * forecast everyone else gets, not take the depot's stock screen down.
 */
export function resolveModel(name: string | null | undefined): DemandModel {
  return MODELS.find((m) => m.name === name) ?? heuristicModel;
}
