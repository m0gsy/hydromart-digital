import { DashboardConfigService } from '../../src/config/dashboard-config.service';
import { AiLoyaltySourcesHttpAdapter } from '../../src/infrastructure/http/ai-loyalty-sources.http.adapter';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const SPAN = { depotId: D1, from: '2026-09-30T17:00:00.000Z', to: '2026-10-31T17:00:00.000Z' };
const WINDOW = { from: '2026-09-30T17:00:00.000Z', to: '2026-10-31T17:00:00.000Z' };

function adapter(blank: Partial<Record<'loyalty' | 'referral' | 'crm', true>> = {}) {
  const config = {
    loyaltyServiceUrl: blank.loyalty ? '' : 'http://loyalty.test',
    referralServiceUrl: blank.referral ? undefined : 'http://referral.test',
    crmServiceUrl: blank.crm ? '' : 'http://crm.test',
    orderServiceUrl: 'http://order.test',
    depotServiceUrl: 'http://depot.test',
    internalServiceKey: 'k',
  } as unknown as DashboardConfigService;
  return new AiLoyaltySourcesHttpAdapter(config);
}

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

const headers = (c: { init?: RequestInit }) => c.init?.headers as Record<string, string>;

describe('AiLoyaltySourcesHttpAdapter (HD-6 H4 part 2)', () => {
  it('posts the spans to loyalty-service with the internal key and returns what it answers', async () => {
    const calls = answer({ redemptions: 9, points: 4500, redeemers: 6, unplaced: 0 });
    await expect(adapter().redemptions([SPAN])).resolves.toEqual({ redemptions: 9, points: 4500, redeemers: 6, unplaced: 0 });
    expect(calls[0].url.href).toBe('http://loyalty.test/api/v1/loyalty/internal/ai/redemptions');
    expect(calls[0].init?.method).toBe('POST');
    expect(headers(calls[0])['x-internal-key']).toBe('k');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ spans: [SPAN] });
  });

  it('asks the network reads with their instants in the query', async () => {
    const p = answer({ accounts: 12, points: 900 });
    await expect(adapter().pointsOutstanding('2026-10-31T17:00:00.000Z')).resolves.toEqual({ accounts: 12, points: 900 });
    expect(p[0].url.pathname).toBe('/api/v1/loyalty/internal/ai/points-outstanding');
    expect(p[0].url.searchParams.get('before')).toBe('2026-10-31T17:00:00.000Z');
    expect(p[0].init?.method).toBe('GET');

    const r = answer({ invited: 3, qualified: 2, qualifiedReferrers: 2, referrerPoints: 100, refereePoints: 50 });
    await expect(adapter().referrals(WINDOW)).resolves.toEqual({ invited: 3, qualified: 2, qualifiedReferrers: 2, referrerPoints: 100, refereePoints: 50 });
    expect(r[0].url.pathname).toBe('/api/v1/referrals/internal/ai/totals');
    expect(r[0].url.searchParams.get('from')).toBe(WINDOW.from);

    const s = answer({ subscriptions: 5, subscribers: 4 });
    await expect(adapter().newSubscriptions(WINDOW)).resolves.toEqual({ subscriptions: 5, subscribers: 4 });
    expect(s[0].url.href.startsWith('http://order.test/api/v1/reports/internal/subscription-metrics?')).toBe(true);

    const c = answer({ campaigns: 1, sent: 9, failed: 1, skipped: 0, other: 0 });
    await expect(adapter().campaigns(WINDOW)).resolves.toEqual({ campaigns: 1, sent: 9, failed: 1, skipped: 0, other: 0 });
    expect(c[0].url.pathname).toBe('/api/v1/campaigns/internal/ai/totals');

    const d = answer({ orders: 10, discountedOrders: 4, discountIdr: 1234.5 });
    await expect(adapter().discounts([SPAN])).resolves.toEqual({ orders: 10, discountedOrders: 4, discountIdr: 1234.5 });
    expect(d[0].url.href).toBe('http://order.test/api/v1/reports/internal/discount-metrics');
    expect(d[0].init?.method).toBe('POST');
  });

  it('asks depot-service for the open queues of the depots, and wants one row for each', async () => {
    const row = (depotId: string) => ({ depotId, incidents: 1, disputes: 0, approvals: 2, maintenanceOverdue: 0 });
    const calls = answer({ items: [row(D1), row(D2)] });
    await expect(adapter().openQueues([D1, D2])).resolves.toEqual([row(D1), row(D2)]);
    expect(calls[0].url.pathname).toBe('/api/v1/internal/ai-queues/open');
    expect(calls[0].url.searchParams.get('depotIds')).toBe(`${D1},${D2}`);
  });

  it.each([
    ['a failed call', { redemptions: 1, points: 1, redeemers: 1, unplaced: 0 }, false],
    ['an unreachable service', 'throw', true],
    ['an answer that is not an object', [1], true],
    ['a string for a number', { redemptions: '1', points: 1, redeemers: 1, unplaced: 0 }, true],
    ['a negative number', { redemptions: 1, points: -1, redeemers: 1, unplaced: 0 }, true],
    ['a fraction of a person', { redemptions: 2, points: 1, redeemers: 1.5, unplaced: 0 }, true],
    ['more redeemers than redemptions', { redemptions: 1, points: 1, redeemers: 2, unplaced: 0 }, true],
    ['redemptions without anybody who redeemed', { redemptions: 3, points: 1, redeemers: 0, unplaced: 0 }, true],
    ['redeemers with no redemption', { redemptions: 0, points: 0, redeemers: 1, unplaced: 0 }, true],
  ])('redemptions are null for %s', async (_name, body, ok) => {
    answer(body, ok as boolean);
    await expect(adapter().redemptions([SPAN])).resolves.toBeNull();
  });

  it('does not ask for no spans, more than 200 spans, or more than 100 depots', async () => {
    const calls = answer({ redemptions: 0, points: 0, redeemers: 0, unplaced: 0 });
    await expect(adapter().redemptions([])).resolves.toBeNull();
    await expect(adapter().discounts([])).resolves.toBeNull();
    await expect(adapter().redemptions(Array.from({ length: 201 }, () => SPAN))).resolves.toBeNull();
    const depots = Array.from({ length: 101 }, (_, i) => ({ ...SPAN, depotId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    await expect(adapter().discounts(depots)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
    await expect(adapter().redemptions(Array.from({ length: 200 }, () => SPAN))).resolves.toEqual({ redemptions: 0, points: 0, redeemers: 0, unplaced: 0 });
  });

  it('does not ask a service that is not wired', async () => {
    const calls = answer({});
    const a = adapter({ loyalty: true, referral: true, crm: true });
    await expect(a.redemptions([SPAN])).resolves.toBeNull();
    await expect(a.pointsOutstanding('2026-10-31T17:00:00.000Z')).resolves.toBeNull();
    await expect(a.referrals(WINDOW)).resolves.toBeNull();
    await expect(a.campaigns(WINDOW)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('is null for referrals with more referrers than referrals, or referrals with no referrer', async () => {
    answer({ invited: 3, qualified: 2, qualifiedReferrers: 3, referrerPoints: 1, refereePoints: 1 });
    await expect(adapter().referrals(WINDOW)).resolves.toBeNull();
    answer({ invited: 3, qualified: 2, qualifiedReferrers: 0, referrerPoints: 1, refereePoints: 1 });
    await expect(adapter().referrals(WINDOW)).resolves.toBeNull();
  });

  it.each([
    ['points outstanding with a string', 'pointsOutstanding'],
    ['referrals with a missing figure', 'referrals'],
    ['campaigns with a negative figure', 'campaigns'],
    ['discounts that exceed the orders', 'discounts'],
    ['subscriptions with more subscribers than plans', 'newSubscriptions'],
  ])('is null for %s', async (_name, method) => {
    const bodies: Record<string, unknown> = {
      pointsOutstanding: { accounts: '3', points: 1 },
      referrals: { invited: 3, qualified: 1, referrerPoints: 1, refereePoints: 1 },
      campaigns: { campaigns: 1, sent: -1, failed: 0, skipped: 0, other: 0 },
      discounts: { orders: 3, discountedOrders: 4, discountIdr: 10 },
      newSubscriptions: { subscriptions: 1, subscribers: 2 },
    };
    answer(bodies[method]);
    const a = adapter() as unknown as Record<string, (arg: unknown) => Promise<unknown>>;
    await expect(a[method](method === 'discounts' ? [SPAN] : method === 'pointsOutstanding' ? 'x' : WINDOW)).resolves.toBeNull();
  });

  it('is null for discounts with money and no discounted order, subscriptions with plans and no subscriber, and a negative discount', async () => {
    const a = adapter();
    answer({ orders: 3, discountedOrders: 0, discountIdr: 10 });
    await expect(a.discounts([SPAN])).resolves.toBeNull();
    answer({ orders: 3, discountedOrders: 1, discountIdr: -1 });
    await expect(a.discounts([SPAN])).resolves.toBeNull();
    answer({ subscriptions: 2, subscribers: 0 });
    await expect(a.newSubscriptions(WINDOW)).resolves.toBeNull();
    answer({ subscriptions: 0, subscribers: 1 });
    await expect(a.newSubscriptions(WINDOW)).resolves.toBeNull();
  });

  it.each([
    ['no items', {}],
    ['a row for a depot nobody asked about', { items: [{ depotId: D2, incidents: 0, disputes: 0, approvals: 0, maintenanceOverdue: 0 }] }],
    ['a row that is not an object', { items: ['x'] }],
    ['a depot twice', { items: [{ depotId: D1, incidents: 0, disputes: 0, approvals: 0, maintenanceOverdue: 0 }, { depotId: D1, incidents: 0, disputes: 0, approvals: 0, maintenanceOverdue: 0 }] }],
    ['a row with a string count', { items: [{ depotId: D1, incidents: '0', disputes: 0, approvals: 0, maintenanceOverdue: 0 }] }],
    ['a depot missing from the answer', { items: [{ depotId: D1, incidents: 0, disputes: 0, approvals: 0, maintenanceOverdue: 0 }] }],
  ])('open queues are null for %s', async (_name, body) => {
    answer(body);
    await expect(adapter().openQueues([D1, D2])).resolves.toBeNull();
  });

  it('does not ask for no depots or more than 100', async () => {
    const calls = answer({ items: [] });
    await expect(adapter().openQueues([])).resolves.toBeNull();
    await expect(adapter().openQueues(Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
