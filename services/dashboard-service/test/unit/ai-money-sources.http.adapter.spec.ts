import { AiMoneySourcesHttpAdapter } from '../../src/infrastructure/http/ai-money-sources.http.adapter';
import { DashboardConfigService } from '../../src/config/dashboard-config.service';

const D1 = '11111111-1111-4111-8111-111111111111';
const RANGE = { from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' };

function adapter(payment = 'http://payment.test') {
  const config = {
    orderServiceUrl: 'http://order.test',
    depotServiceUrl: 'http://depot.test',
    deliveryServiceUrl: 'http://delivery.test',
    paymentServiceUrl: payment,
    internalServiceKey: 'k',
  } as unknown as DashboardConfigService;
  return new AiMoneySourcesHttpAdapter(config);
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

const saleRow = { depotId: D1, orders: 1, revenueIdr: 1, shippingIdr: 1, appOrders: 1, appRevenueIdr: 1, counterOrders: 0, counterRevenueIdr: 0, cancelledOrders: 0, deliveredOrders: 0 };

describe('AiMoneySourcesHttpAdapter (HD-6 H2)', () => {
  it('asks order-service for the depots and the instants, with the internal key', async () => {
    const calls = answer({ items: [saleRow] });
    await expect(adapter().salesSummary([D1], RANGE)).resolves.toEqual([saleRow]);
    expect(calls[0].url.pathname).toBe('/api/v1/reports/internal/depot-sales-summary');
    expect(calls[0].url.searchParams.get('depotIds')).toBe(D1);
    expect(calls[0].url.searchParams.get('from')).toBe(RANGE.from);
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it.each([
    ['a failed call', { items: [] }, false],
    ['an unreachable service', 'throw', true],
    ['an answer without the list', {}, true],
    ['a row missing a number', { items: [{ ...saleRow, orders: 'x' }] }, true],
  ])('is null for %s', async (_name, body, ok) => {
    answer(body, ok as boolean);
    await expect(adapter().salesSummary([D1], RANGE)).resolves.toBeNull();
  });

  it('maps the product report and refuses a malformed one', async () => {
    answer({ items: [{ productId: 'p', productName: 'Galon', orderCount: 2, revenue: 5 }, { productName: 'Tanpa id', orderCount: 1, revenue: 1 }] });
    await expect(adapter().productRevenue([D1], RANGE)).resolves.toEqual([
      { productId: 'p', productName: 'Galon', orders: 2, revenueIdr: 5 },
      { productId: 'Tanpa id', productName: 'Tanpa id', orders: 1, revenueIdr: 1 },
    ]);
    answer({ items: [{ productName: 1 }] });
    await expect(adapter().productRevenue([D1], RANGE)).resolves.toBeNull();
    answer({});
    await expect(adapter().productRevenue([D1], RANGE)).resolves.toBeNull();
  });

  it('maps the time and area report and refuses a malformed one', async () => {
    const good = {
      heat: [[1]],
      byWeekday: [{ weekday: 1, orders: 1, revenue: 2 }],
      byArea: [{ area: 'Bekasi', orders: 1, revenue: 2 }],
      otherAreas: { areas: 3, orders: 4, revenue: 5 },
    };
    answer(good);
    await expect(adapter().timeArea([D1], RANGE)).resolves.toEqual({
      heat: [[1]],
      byWeekday: [{ weekday: 1, orders: 1, revenueIdr: 2 }],
      byArea: [{ area: 'Bekasi', orders: 1, revenueIdr: 2 }],
      otherAreas: { orders: 4, revenueIdr: 5 },
    });
    answer({ ...good, otherAreas: null });
    expect((await adapter().timeArea([D1], RANGE))?.otherAreas).toBeNull();
    for (const bad of [{ ...good, heat: 'x' }, { ...good, heat: [['a']] }, { ...good, byWeekday: [{}] }, { ...good, byArea: [{}] }, { ...good, byArea: 1 }]) {
      answer(bad);
      await expect(adapter().timeArea([D1], RANGE)).resolves.toBeNull();
    }
    answer(null);
    await expect(adapter().timeArea([D1], RANGE)).resolves.toBeNull();
  });

  it('asks payment-service for money by kind, and is null when it is not wired or answers badly', async () => {
    const row = { depotId: D1, channel: 'counter', method: 'CASH', amountIdr: 5, count: 1 };
    const calls = answer({ rows: [row] });
    await expect(adapter().money('collected', [D1], RANGE)).resolves.toEqual([row]);
    expect(calls[0].url.pathname).toBe('/api/v1/payments/internal/depot-money');
    expect(calls[0].url.searchParams.get('kind')).toBe('collected');
    await expect(adapter('').money('collected', [D1], RANGE)).resolves.toBeNull();
    answer({ rows: [{ ...row, channel: 'x' }] });
    await expect(adapter().money('pending', [D1], RANGE)).resolves.toBeNull();
    answer({});
    await expect(adapter().money('refunded', [D1], RANGE)).resolves.toBeNull();
  });

  it('asks which orders still count, in batches of 5000, and is null if one batch fails', async () => {
    const ids = Array.from({ length: 5001 }, (_, i) => `o${i}`);
    const calls = answer({ orderIds: ['o1'] });
    const counting = await adapter().countingOrders(ids);
    expect([...(counting ?? [])]).toEqual(['o1']);
    expect(calls.map((c) => JSON.parse(String(c.init?.body)).orderIds.length)).toEqual([5000, 1]);
    expect(calls[0].init?.method).toBe('POST');
    answer({});
    await expect(adapter().countingOrders(['o1'])).resolves.toBeNull();
    await expect(adapter().countingOrders([])).resolves.toEqual(new Set());
  });

  it('reads one depot cashbook, closed days, COD deposits and cash flow, null on a bad answer', async () => {
    answer({ cogsIdr: 1, opexIdr: 2 });
    await expect(adapter().cashbookCosts(D1, RANGE)).resolves.toEqual({ cogsIdr: 1, opexIdr: 2 });
    answer({ cogsIdr: 1 });
    await expect(adapter().cashbookCosts(D1, RANGE)).resolves.toBeNull();

    answer({ daysClosed: 12 });
    await expect(adapter().daysClosed(D1, RANGE)).resolves.toBe(12);
    answer({});
    await expect(adapter().daysClosed(D1, RANGE)).resolves.toBeNull();

    const period = { depositedIdr: 5, expectedIdr: 6, shortfallIdr: 2, surplusIdr: 1, undepositedIdr: 4 };
    const calls = answer({ ...period, undepositedDeliveries: 2 });
    await expect(adapter().codPeriod(D1, RANGE)).resolves.toEqual(period);
    expect(calls[0].url.pathname).toBe('/api/v1/settlements/internal/cod-period');
    answer({ depositedIdr: 5 });
    await expect(adapter().codPeriod(D1, RANGE)).resolves.toBeNull();

    const shifts = answer({ shifts: 3, shortfallIdr: 2, surplusIdr: 1 });
    await expect(adapter().shiftVariance(D1, RANGE)).resolves.toEqual({ shifts: 3, shortfallIdr: 2, surplusIdr: 1 });
    expect(shifts[0].url.pathname).toBe('/api/v1/cashier-shifts/internal/variance');
    answer({ shifts: 3 });
    await expect(adapter().shiftVariance(D1, RANGE)).resolves.toBeNull();

    answer({ netCashFlowIdr: 9 });
    await expect(adapter().cashFlow(D1, '2026-11')).resolves.toEqual({ netCashFlowIdr: 9 });
    answer({ netCashFlowIdr: null });
    await expect(adapter().cashFlow(D1, '2026-11')).resolves.toEqual({ netCashFlowIdr: null });
    answer({ netCashFlowIdr: 'x' });
    await expect(adapter().cashFlow(D1, '2026-11')).resolves.toBeNull();
    answer('throw');
    await expect(adapter().cashFlow(D1, '2026-11')).resolves.toBeNull();
  });
});
