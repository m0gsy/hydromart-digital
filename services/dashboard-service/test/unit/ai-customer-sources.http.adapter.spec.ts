import { AiCustomerSourcesHttpAdapter } from '../../src/infrastructure/http/ai-customer-sources.http.adapter';
import { DashboardConfigService } from '../../src/config/dashboard-config.service';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const SPANS = [{ depotId: D1, from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' }];
const RANGE = { from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' };

const adapter = () =>
  new AiCustomerSourcesHttpAdapter({
    orderServiceUrl: 'http://order.test',
    depotServiceUrl: 'http://depot.test',
    deliveryServiceUrl: 'http://delivery.test',
    internalServiceKey: 'k',
  } as unknown as DashboardConfigService);

/** Answers every call with `body` (or a failure), and records the calls. */
function answer(body: unknown, ok = true) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    if (body === 'throw') throw new Error('network down');
    return { ok, status: ok ? 200 : 503, json: async () => body } as unknown as Response;
  });
  return calls;
}
afterEach(() => jest.restoreAllMocks());

/** A source that cannot answer, in each of the ways it can. */
const BROKEN: [string, unknown, boolean][] = [
  ['a failed call', {}, false],
  ['an unreachable service', 'throw', true],
  ['an answer that is not an object', 'oops', true],
  ['null', null, true],
];

describe('AiCustomerSourcesHttpAdapter (HD-6 H3)', () => {
  it('posts the spans to order-service with the internal key and reads the customer window', async () => {
    const calls = answer({ active: 10, newCustomers: 4, repeat: 5, newAtDepot: [{ depotId: D1, customers: 3 }] });
    await expect(adapter().customerWindow(SPANS, RANGE.from)).resolves.toEqual({
      active: 10,
      newCustomers: 4,
      repeat: 5,
      newAtDepot: [{ depotId: D1, customers: 3 }],
    });
    expect(calls[0].url.pathname).toBe('/api/v1/reports/internal/customer-metrics');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ spans: SPANS, periodFrom: RANGE.from });
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it.each(BROKEN)('every reader is null for %s', async (_name, body, ok) => {
    answer(body, ok);
    const a = adapter();
    expect(await a.customerWindow(SPANS, RANGE.from)).toBeNull();
    expect(await a.cohorts(SPANS)).toBeNull();
    expect(await a.ratings(SPANS)).toBeNull();
    expect(await a.segments([D1], { riskSince: RANGE.from, activeSince: RANGE.from, until: RANGE.to })).toBeNull();
    expect(await a.gallonsSold(SPANS)).toBeNull();
    expect(await a.refillSplit(SPANS)).toBeNull();
    expect(await a.liveOrders([D1])).toBeNull();
    expect(await a.deliverySummary(SPANS)).toBeNull();
    expect(await a.cancelledBeforeDeparture(SPANS)).toBeNull();
    expect(await a.gallonLedger([D1], RANGE)).toBeNull();
  });

  it('reads the cancellations before departure and refuses anything that is not a count', async () => {
    const calls = answer({ cancelled: 4 });
    await expect(adapter().cancelledBeforeDeparture(SPANS)).resolves.toBe(4);
    expect(calls[0].url.pathname).toBe('/api/v1/reports/internal/cancelled-before-departure');
    jest.restoreAllMocks();
    for (const bad of [{ cancelled: -1 }, { cancelled: '4' }, {}]) {
      answer(bad);
      expect(await adapter().cancelledBeforeDeparture(SPANS)).toBeNull();
      jest.restoreAllMocks();
    }
  });

  it('refuses a customer window that is not whole numbers, names a depot nobody asked, or has parts bigger than the whole', async () => {
    const good = { active: 10, newCustomers: 4, repeat: 5, newAtDepot: [] };
    for (const bad of [
      { ...good, active: 10.5 },
      { ...good, repeat: -1 },
      { ...good, newCustomers: '4' },
      { ...good, newAtDepot: 'x' },
      { ...good, newAtDepot: [{ depotId: D2, customers: 1 }] },
      { ...good, newAtDepot: [{ depotId: D1, customers: 'x' }] },
      { ...good, newCustomers: 11 },
      { ...good, repeat: 11 },
    ]) {
      answer(bad);
      expect(await adapter().customerWindow(SPANS, RANGE.from)).toBeNull();
      jest.restoreAllMocks();
    }
  });

  it('reads the cohorts and refuses a cell it does not understand', async () => {
    const cells = [{ cohort: '2026-09', monthIndex: 0, customers: 5 }];
    answer({ cells });
    await expect(adapter().cohorts(SPANS)).resolves.toEqual(cells);
    jest.restoreAllMocks();
    for (const bad of [{ cells: 'x' }, { cells: [{ cohort: '2026-9', monthIndex: 0, customers: 5 }] }, { cells: [{ cohort: '2026-09', monthIndex: -1, customers: 5 }] }, { cells: [{ cohort: '2026-09', monthIndex: 0, customers: 1.5 }] }]) {
      answer(bad);
      expect(await adapter().cohorts(SPANS)).toBeNull();
      jest.restoreAllMocks();
    }
  });

  it('reads ratings and refuses stars that cannot be a sum of 1-5 reviews', async () => {
    answer({ reviews: 4, ratingSum: 18, reviewers: 3 });
    await expect(adapter().ratings(SPANS)).resolves.toEqual({ reviews: 4, ratingSum: 18, reviewers: 3 });
    jest.restoreAllMocks();
    for (const bad of [{ reviews: 4, ratingSum: 3, reviewers: 1 }, { reviews: 4, ratingSum: 21, reviewers: 1 }, { reviews: 4, ratingSum: 10, reviewers: 5 }, { reviews: 'x', ratingSum: 1, reviewers: 1 }]) {
      answer(bad);
      expect(await adapter().ratings(SPANS)).toBeNull();
      jest.restoreAllMocks();
    }
  });

  it('reads segments, gallons, the refill split and live orders', async () => {
    const calls = answer({ active: 3, atRisk: 2, inactive: 1 });
    await expect(adapter().segments([D1, D2], { riskSince: 'a', activeSince: 'b', until: 'c' })).resolves.toEqual({ active: 3, atRisk: 2, inactive: 1 });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ depotIds: `${D1},${D2}`, riskSince: 'a', activeSince: 'b', until: 'c' });
    jest.restoreAllMocks();
    answer({ gallons: 12 });
    await expect(adapter().gallonsSold(SPANS)).resolves.toBe(12);
    jest.restoreAllMocks();
    answer({ gallons: -1 });
    await expect(adapter().gallonsSold(SPANS)).resolves.toBeNull();
    jest.restoreAllMocks();
    answer({ refill: 1, partial: 2, beli: 3, notAsked: 4 });
    await expect(adapter().refillSplit(SPANS)).resolves.toEqual({ refill: 1, partial: 2, beli: 3, notAsked: 4 });
    jest.restoreAllMocks();
    const live = answer({ byStatus: [{ status: 'CREATED', count: 2 }] });
    await expect(adapter().liveOrders([D1])).resolves.toEqual([{ status: 'CREATED', count: 2 }]);
    expect(live[0].url.searchParams.get('depotIds')).toBe(D1);
    jest.restoreAllMocks();
    for (const bad of [{ byStatus: 'x' }, { byStatus: [{ status: 1, count: 2 }] }, { byStatus: [{ status: 'CREATED', count: 'x' }] }]) {
      answer(bad);
      expect(await adapter().liveOrders([D1])).toBeNull();
      jest.restoreAllMocks();
    }
  });

  const summary = { delivered: 10, onTime: 8, storedVerdicts: 6, thresholdMinutes: 90, medianMinutes: 40.5, couriers: 3, failed: 3, noShow: 1, otherFailed: 2, rescheduled: 1 };

  it('reads the delivery summary and refuses one whose parts do not fit their wholes', async () => {
    const calls = answer(summary);
    await expect(adapter().deliverySummary(SPANS)).resolves.toEqual(summary);
    expect(calls[0].url.href).toBe('http://delivery.test/api/v1/reports/internal/ai-summary');
    jest.restoreAllMocks();
    for (const bad of [
      { ...summary, onTime: 11 },
      { ...summary, storedVerdicts: 11 },
      { ...summary, couriers: 14 },
      { ...summary, couriers: 0 },
      { ...summary, noShow: 2 },
      { ...summary, medianMinutes: null },
      { ...summary, delivered: 0, onTime: 0, storedVerdicts: 0, couriers: 0, failed: 0, noShow: 0, otherFailed: 0, medianMinutes: 5 },
      { ...summary, medianMinutes: 'x' },
      { ...summary, thresholdMinutes: 'x' },
      { ...summary, failed: 3.5 },
    ]) {
      answer(bad);
      expect(await adapter().deliverySummary(SPANS)).toBeNull();
      jest.restoreAllMocks();
    }
    // depots that grade with different thresholds: null is a real answer, a string is not
    answer({ ...summary, thresholdMinutes: null });
    await expect(adapter().deliverySummary(SPANS)).resolves.toMatchObject({ thresholdMinutes: null });
    jest.restoreAllMocks();
    // nothing delivered: a null median is exactly right
    answer({ ...summary, delivered: 0, onTime: 0, storedVerdicts: 0, couriers: 0, failed: 0, noShow: 0, otherFailed: 0, medianMinutes: null });
    await expect(adapter().deliverySummary(SPANS)).resolves.toMatchObject({ delivered: 0, medianMinutes: null });
  });

  const row = (depotId: string, o: Record<string, unknown> = {}) => ({
    depotId,
    issuedTotal: 10,
    returnedTotal: 4,
    depositHeldTotal: 100,
    depositRefundedTotal: 40,
    issuedInWindow: 3,
    depositHeldInWindow: 30,
    returnedGoodInWindow: 1,
    returnedDamagedInWindow: -1,
    depositRefundedInWindow: 10,
    ...o,
  });

  it('reads the gallon ledger (a window sum may be negative after a void) and refuses an unasked, duplicate or malformed row', async () => {
    const calls = answer({ items: [row(D1)] });
    await expect(adapter().gallonLedger([D1], RANGE)).resolves.toEqual([row(D1)]);
    expect(calls[0].url.pathname).toBe('/api/v1/gallon-outstanding/internal/ledger-summary');
    expect(calls[0].url.searchParams.get('depotIds')).toBe(D1);
    expect(calls[0].url.searchParams.get('from')).toBe(RANGE.from);
    jest.restoreAllMocks();
    // a depot with no ledger row is absent, and that is an answer
    answer({ items: [] });
    await expect(adapter().gallonLedger([D1], RANGE)).resolves.toEqual([]);
    jest.restoreAllMocks();
    for (const bad of [{ items: 'x' }, { items: [row(D2)] }, { items: [row(D1), row(D1)] }, { items: [row(D1, { issuedTotal: 'x' })] }, { items: [row(D1, { depotId: 5 })] }, { items: [null] }]) {
      answer(bad);
      expect(await adapter().gallonLedger([D1], RANGE)).toBeNull();
      jest.restoreAllMocks();
    }
  });
});
