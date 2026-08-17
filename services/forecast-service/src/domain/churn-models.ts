import { ChurnRisk, churnRisk } from './churn';

/**
 * PR-J, the churn half of the seam. Same shape as `models.ts` next door and for the same
 * reason: `churn.ts` carried a comment promising "upgrade path is a fitted model at this
 * seam", and a comment is not a seam. Nothing could be run in the heuristic's place, so
 * nothing could be measured against it — including the question nobody had asked, which is
 * whether RFM-lite beats plain recency at all.
 *
 * Deliberately NOT fitted. The restore drill reports `hydromart_forecast: no rows live`;
 * a classifier trained on that would be confidently worse than the heuristic it replaced.
 */

export interface ChurnActivity {
  lastOrderAt: Date;
  orderCount: number;
  totalSpent?: number;
}

export interface ChurnOptions {
  windowDays: number;
  monetaryRef?: number;
}

export interface ChurnModel {
  readonly name: string;
  readonly description: string;
  score(activity: ChurnActivity, now: Date, opts: ChurnOptions): ChurnRisk;
}

/**
 * The BASELINE: risk is how long it has been, and nothing else. Every refinement — the
 * frequency damper, the monetary damper — has to earn its place against this. If it cannot,
 * it is a story about customers rather than a fact about them.
 */
export const recencyOnlyChurnModel: ChurnModel = {
  name: 'recency-only',
  description: 'Days since the last order over the window. The number to beat.',
  score: (activity, now, opts) =>
    // Same function with both dampers switched off: one code path, so the baseline can
    // never drift away from the thing it is the baseline FOR.
    churnRisk({ ...activity, orderCount: 1, totalSpent: 0 }, now, {
      windowDays: opts.windowDays,
      monetaryRef: 0,
    }),
};

/** What production has always done: recency dampened by frequency and lifetime spend. */
export const heuristicChurnModel: ChurnModel = {
  name: 'rfm-lite',
  description: 'Recency dampened by order count and lifetime spend (the shipped heuristic).',
  score: (activity, now, opts) => churnRisk(activity, now, opts),
};

export const CHURN_MODELS: readonly ChurnModel[] = [heuristicChurnModel, recencyOnlyChurnModel];

export const DEFAULT_CHURN_MODEL = heuristicChurnModel.name;

/** An unknown name resolves to the shipped heuristic — this is read on a request path. */
export function resolveChurnModel(name: string | null | undefined): ChurnModel {
  return CHURN_MODELS.find((m) => m.name === name) ?? heuristicChurnModel;
}
