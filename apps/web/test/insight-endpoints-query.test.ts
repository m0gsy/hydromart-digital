import { describe, expect, it } from 'vitest';

import { endpoints } from '@/lib/endpoints';

/**
 * The reporting query builders, from both sides.
 *
 * These are the URLs behind the revenue, retention, shipping and refund reports, and every
 * one is a chain of `if (q.x)` guards. The screens that call them almost always pass a date
 * range, so the no-argument path — the one a freshly-opened report takes before anybody
 * picks a window — was the path nothing walked. That is where a trailing `?`,
 * a `from=undefined`, or a dropped filter hides.
 *
 * `segmentEstimate` is the one that matters most: it guards on `!= null` rather than
 * truthiness, because `0` is a legitimate value for every one of its four numbers and a
 * truthiness check would silently drop it.
 */

const noPlaceholders = (url: string) => {
  expect(url).not.toContain('=undefined');
  expect(url).not.toContain('=null');
  expect(url).not.toMatch(/\?$/);
  expect(url).not.toContain('?&');
  expect(url).not.toContain('&&');
};

const r = endpoints.reports;
// `estimate` lives under `segments`, not `reports` — the audience-size probe behind the
// segment builder, and the only one of these that guards on `!= null`.
const segments = endpoints.segments;

describe('report builders with no window chosen yet', () => {
  const bare: Array<[string, string]> = [
    ['revenueByCategory', r.revenueByCategory()],
    ['retentionCohort', r.retentionCohort()],
    ['shippingByDepot', r.shippingByDepot()],
    ['refundsByDepot', r.refundsByDepot()],
    ['audienceReach', r.audienceReach()],
    ['segments.estimate', segments.estimate({})],
  ];

  for (const [name, url] of bare) {
    it(`${name} emits a clean path`, () => {
      noPlaceholders(url);
      expect(url.startsWith('/')).toBe(true);
    });
  }
});

describe('report builders with a window chosen', () => {
  it('revenueByCategory carries both ends and the cap', () => {
    const url = r.revenueByCategory({ from: '2026-08-01', to: '2026-08-31', limit: 10 });
    noPlaceholders(url);
    expect(url).toContain('from=2026-08-01');
    expect(url).toContain('to=2026-08-31');
    expect(url).toContain('limit=10');
  });

  it('the three two-date reports each carry both ends', () => {
    for (const build of [r.retentionCohort, r.shippingByDepot, r.refundsByDepot]) {
      const url = build({ from: '2026-08-01', to: '2026-08-31' });
      noPlaceholders(url);
      expect(url).toContain('from=2026-08-01');
      expect(url).toContain('to=2026-08-31');
    }
  });

  it('each of the three reports keeps its own path', () => {
    // They share a shape, which is exactly how one could end up pointing at another's route.
    const paths = [r.retentionCohort({}), r.shippingByDepot({}), r.refundsByDepot({})];
    expect(new Set(paths).size).toBe(3);
  });

  it('audienceReach scopes to a depot only when given one', () => {
    expect(r.audienceReach('depot-1')).toContain('depotId=depot-1');
    expect(r.audienceReach()).not.toContain('depotId');
  });
});

describe('segments.estimate guards on null, not on truthiness', () => {
  it('keeps a zero, which a truthiness check would drop', () => {
    // Zero is a real answer for all four: "ordered within 0 days", "at least 0 orders".
    const url = segments.estimate({
      recencyDays: 0,
      lapsedDays: 0,
      newWithinDays: 0,
      minOrders: 0,
    });
    noPlaceholders(url);
    for (const key of ['recencyDays=0', 'lapsedDays=0', 'newWithinDays=0', 'minOrders=0']) {
      expect(url).toContain(key);
    }
  });

  it('carries the depot alongside the four numbers', () => {
    const url = segments.estimate({ recencyDays: 30, minOrders: 2, depotId: 'depot-1' });
    noPlaceholders(url);
    expect(url).toContain('recencyDays=30');
    expect(url).toContain('minOrders=2');
    expect(url).toContain('depotId=depot-1');
    // Absent keys stay absent rather than arriving as the string "undefined".
    expect(url).not.toContain('lapsedDays');
  });
});
