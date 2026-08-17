import { ChurnActivity, ChurnModel, ChurnOptions } from './churn-models';

/**
 * PR-J: the churn half of the offline evaluation. A churn score is a RANKING, not a
 * number anybody reads — the only thing it is used for is "who do we contact first". So
 * the metric is AUC: the probability that a randomly chosen customer who did churn is
 * ranked above a randomly chosen customer who did not.
 *
 * Read it as: 0.5 is a coin toss, and a model at 0.5 is a model that sorts the outreach
 * list at random. Below 0.5 it is worse than random and the ranking should be inverted.
 * Accuracy is deliberately NOT reported: with most customers not churning, "nobody
 * churns" scores 90% and is useless, which is how a useless model gets shipped.
 */

export interface ChurnSample {
  activity: ChurnActivity;
  /** Did this customer actually lapse over the evaluation horizon? */
  churned: boolean;
}

export interface ChurnMetrics {
  model: string;
  n: number;
  churned: number;
  /** null when a set has only one class — AUC is undefined there, not 0.5. */
  auc: number | null;
}

/**
 * Mann-Whitney U, which is exactly AUC and needs no threshold sweep. Ties count a half,
 * because a model that gives two customers the same score has genuinely not separated
 * them and should not be paid for the coin flip.
 */
export function rocAuc(scored: { score: number; churned: boolean }[]): number | null {
  const positives = scored.filter((s) => s.churned);
  const negatives = scored.filter((s) => !s.churned);
  if (positives.length === 0 || negatives.length === 0) return null;
  let wins = 0;
  for (const p of positives) {
    for (const n of negatives) {
      if (p.score > n.score) wins += 1;
      else if (p.score === n.score) wins += 0.5;
    }
  }
  return Math.round((wins / (positives.length * negatives.length)) * 1000) / 1000;
}

export function evaluateChurn(
  samples: ChurnSample[],
  model: ChurnModel,
  now: Date,
  opts: ChurnOptions,
): ChurnMetrics {
  const scored = samples.map((s) => ({
    score: model.score(s.activity, now, opts).riskScore,
    churned: s.churned,
  }));
  return {
    model: model.name,
    n: samples.length,
    churned: scored.filter((s) => s.churned).length,
    auc: rocAuc(scored),
  };
}

export interface ChurnComparison {
  baseline: ChurnMetrics;
  candidates: (ChurnMetrics & { aucDelta: number | null })[];
}

/**
 * Every candidate against the baseline on the same customers and the same horizon.
 * `aucDelta` is POSITIVE when the candidate ranks better — the opposite sign convention to
 * the demand comparison next door, because there the metric is error and here it is skill.
 * Stating it once here stops every reader deriving it differently.
 */
export function compareChurn(
  samples: ChurnSample[],
  baseline: ChurnModel,
  candidates: ChurnModel[],
  now: Date,
  opts: ChurnOptions,
): ChurnComparison {
  const base = evaluateChurn(samples, baseline, now, opts);
  return {
    baseline: base,
    candidates: candidates.map((model) => {
      const metrics = evaluateChurn(samples, model, now, opts);
      return {
        ...metrics,
        aucDelta:
          metrics.auc === null || base.auc === null
            ? null
            : Math.round((metrics.auc - base.auc) * 1000) / 1000,
      };
    }),
  };
}

/**
 * Turn order history into labelled samples at a point in time: what was known on `cut`,
 * and whether they ordered again in the `horizonDays` after it.
 *
 * The cut is the whole discipline. Scoring a customer with knowledge of orders placed
 * after it is the churn equivalent of reading tomorrow's demand — it produces a beautiful
 * AUC and a model that cannot reproduce it once.
 */
export function buildChurnSamples(
  customers: { orders: { at: Date; total?: number }[] }[],
  cut: Date,
  horizonDays: number,
): ChurnSample[] {
  const horizonEnd = new Date(cut.getTime() + horizonDays * 86_400_000);
  const samples: ChurnSample[] = [];
  for (const customer of customers) {
    const before = customer.orders.filter((o) => o.at <= cut);
    if (before.length === 0) continue; // never ordered: no basis for a risk, same as churnFor()
    const lastOrderAt = before.reduce((a, b) => (a.at > b.at ? a : b)).at;
    const after = customer.orders.some((o) => o.at > cut && o.at <= horizonEnd);
    samples.push({
      activity: {
        lastOrderAt,
        orderCount: before.length,
        totalSpent: before.reduce((sum, o) => sum + (o.total ?? 0), 0),
      },
      churned: !after,
    });
  }
  return samples;
}
