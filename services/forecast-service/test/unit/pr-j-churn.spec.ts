import {
  buildChurnSamples,
  compareChurn,
  evaluateChurn,
  rocAuc,
} from '../../src/domain/churn-evaluate';
import {
  CHURN_MODELS,
  DEFAULT_CHURN_MODEL,
  heuristicChurnModel,
  recencyOnlyChurnModel,
  resolveChurnModel,
} from '../../src/domain/churn-models';

const NOW = new Date('2026-08-17T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const OPTS = { windowDays: 60, monetaryRef: 1_000_000 };

describe('PR-J: the churn half of the seam', () => {
  describe('models', () => {
    it('keeps RFM-lite as the default, and resolves a typo to it', () => {
      expect(DEFAULT_CHURN_MODEL).toBe('rfm-lite');
      expect(resolveChurnModel(undefined)).toBe(heuristicChurnModel);
      expect(resolveChurnModel('rfm_lite')).toBe(heuristicChurnModel);
      for (const m of CHURN_MODELS) expect(resolveChurnModel(m.name)).toBe(m);
    });

    it('the baseline ignores frequency and spend — that is what makes it a baseline', () => {
      const loyalBigSpender = { lastOrderAt: daysAgo(30), orderCount: 20, totalSpent: 5_000_000 };
      const oneTimer = { lastOrderAt: daysAgo(30), orderCount: 1, totalSpent: 0 };
      expect(recencyOnlyChurnModel.score(loyalBigSpender, NOW, OPTS).riskScore).toBeCloseTo(
        recencyOnlyChurnModel.score(oneTimer, NOW, OPTS).riskScore,
      );
      // The heuristic must disagree, or it is the baseline wearing another name.
      expect(heuristicChurnModel.score(loyalBigSpender, NOW, OPTS).riskScore).toBeLessThan(
        heuristicChurnModel.score(oneTimer, NOW, OPTS).riskScore,
      );
    });
  });

  describe('rocAuc', () => {
    it('is 1 when every churner outranks every stayer', () => {
      expect(
        rocAuc([
          { score: 0.9, churned: true },
          { score: 0.8, churned: true },
          { score: 0.2, churned: false },
        ]),
      ).toBe(1);
    });

    it('is 0 when the ranking is exactly backwards — worse than random, and it says so', () => {
      expect(
        rocAuc([
          { score: 0.1, churned: true },
          { score: 0.9, churned: false },
        ]),
      ).toBe(0);
    });

    it('pays half for a tie, because a tie has separated nobody', () => {
      expect(
        rocAuc([
          { score: 0.5, churned: true },
          { score: 0.5, churned: false },
        ]),
      ).toBe(0.5);
    });

    it('is null with one class only — undefined, not a coin toss', () => {
      expect(rocAuc([{ score: 0.5, churned: true }])).toBeNull();
      expect(rocAuc([{ score: 0.5, churned: false }])).toBeNull();
      expect(rocAuc([])).toBeNull();
    });
  });

  describe('buildChurnSamples', () => {
    const cut = new Date('2026-07-01T00:00:00.000Z');
    const at = (iso: string) => new Date(iso);

    it('labels a customer who came back as NOT churned', () => {
      const [sample] = buildChurnSamples(
        [{ orders: [{ at: at('2026-06-01T00:00:00Z') }, { at: at('2026-07-10T00:00:00Z') }] }],
        cut,
        30,
      );
      expect(sample.churned).toBe(false);
      expect(sample.activity.orderCount).toBe(1); // only what was known at the cut
    });

    it('labels a customer who never came back as churned', () => {
      const [sample] = buildChurnSamples([{ orders: [{ at: at('2026-06-01T00:00:00Z') }] }], cut, 30);
      expect(sample.churned).toBe(true);
    });

    it('does not count a return AFTER the horizon as a return', () => {
      const [sample] = buildChurnSamples(
        [{ orders: [{ at: at('2026-06-01T00:00:00Z') }, { at: at('2026-08-15T00:00:00Z') }] }],
        cut,
        30,
      );
      expect(sample.churned).toBe(true);
    });

    it('never reads an order placed after the cut into the features', () => {
      const [sample] = buildChurnSamples(
        [
          {
            orders: [
              { at: at('2026-06-01T00:00:00Z'), total: 50_000 },
              { at: at('2026-07-10T00:00:00Z'), total: 999_999 },
            ],
          },
        ],
        cut,
        30,
      );
      expect(sample.activity.totalSpent).toBe(50_000);
      expect(sample.activity.lastOrderAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });

    it('skips a customer with nothing before the cut — no basis for a risk', () => {
      expect(buildChurnSamples([{ orders: [{ at: at('2026-07-05T00:00:00Z') }] }], cut, 30)).toEqual([]);
      expect(buildChurnSamples([{ orders: [] }], cut, 30)).toEqual([]);
    });

    it('treats an order with no total as zero spend rather than as NaN', () => {
      const [sample] = buildChurnSamples(
        [{ orders: [{ at: at('2026-06-01T00:00:00Z') }, { at: at('2026-06-02T00:00:00Z'), total: 5_000 }] }],
        cut,
        30,
      );
      expect(sample.activity.totalSpent).toBe(5_000);
    });

    it('takes the LATEST order before the cut, whatever order they arrive in', () => {
      const [sample] = buildChurnSamples(
        [{ orders: [{ at: at('2026-06-20T00:00:00Z') }, { at: at('2026-06-01T00:00:00Z') }] }],
        cut,
        30,
      );
      expect(sample.activity.lastOrderAt.toISOString()).toBe('2026-06-20T00:00:00.000Z');
    });
  });

  describe('evaluateChurn / compareChurn', () => {
    const samples = [
      { activity: { lastOrderAt: daysAgo(59), orderCount: 1, totalSpent: 0 }, churned: true },
      { activity: { lastOrderAt: daysAgo(50), orderCount: 2, totalSpent: 10_000 }, churned: true },
      { activity: { lastOrderAt: daysAgo(3), orderCount: 9, totalSpent: 900_000 }, churned: false },
      { activity: { lastOrderAt: daysAgo(1), orderCount: 4, totalSpent: 400_000 }, churned: false },
    ];

    it('counts what it scored and how many of them lapsed', () => {
      const m = evaluateChurn(samples, heuristicChurnModel, NOW, OPTS);
      expect(m).toMatchObject({ model: 'rfm-lite', n: 4, churned: 2 });
      expect(m.auc).toBe(1);
    });

    it('states the delta so that POSITIVE means the candidate ranks better', () => {
      const result = compareChurn(samples, recencyOnlyChurnModel, [heuristicChurnModel], NOW, OPTS);
      expect(result.baseline.model).toBe('recency-only');
      const [candidate] = result.candidates;
      expect(candidate.aucDelta).toBeCloseTo((candidate.auc ?? 0) - (result.baseline.auc ?? 0), 3);
    });

    it('reports no delta rather than a fake one when AUC is undefined', () => {
      const oneClass = [samples[0]];
      const [candidate] = compareChurn(oneClass, recencyOnlyChurnModel, [heuristicChurnModel], NOW, OPTS)
        .candidates;
      expect(candidate.auc).toBeNull();
      expect(candidate.aucDelta).toBeNull();
    });

    it('runs with no candidates at all', () => {
      expect(compareChurn(samples, recencyOnlyChurnModel, [], NOW, OPTS).candidates).toEqual([]);
    });
  });
});
