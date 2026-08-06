import { churnRisk } from '../../src/domain/churn';
import { ForecastService } from '../../src/application/services/forecast.service';
import { ForecastPrismaRepository } from '../../src/infrastructure/prisma/forecast.prisma.repository';
import { OrderFeedHttpAdapter } from '../../src/infrastructure/http/order-feed.http.adapter';
import type { ForecastConfigService } from '../../src/config/forecast-config.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/** Churn ranking is what these tests are about; names are a decoration on it. */
const noNames = async () => new Map<string, string>();


// Rows the catalogue no longer knows about, a customer who has never spent anything, a revenue
// query for "all depots" vs "the null depot", and an order the feed hands over with no
// timestamp — the cases the happy-path specs never produce.

describe('churnRisk with no spend recorded', () => {
  it('treats a missing total as zero rather than skipping the monetary damping', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const activity = { lastOrderAt: new Date('2026-07-01T00:00:00.000Z'), orderCount: 1 };

    const withoutSpend = churnRisk(activity, now, { windowDays: 60, monetaryRef: 100_000 });
    const withZeroSpend = churnRisk({ ...activity, totalSpent: 0 }, now, {
      windowDays: 60,
      monetaryRef: 100_000,
    });

    expect(withoutSpend).toEqual(withZeroSpend);
    expect(withoutSpend.riskBand).toBe('MEDIUM');
  });
});

describe('ForecastService.depotRollup', () => {
  const config = {} as unknown as ForecastConfigService;
  const rows = (productId: string, quantity: number) => ({
    productId,
    rows: [{ day: 20_300, quantity }],
  });

  it('reports a product the catalogue no longer lists with null name, sku and unit', async () => {
    const repo = {
      listDepotProducts: jest.fn().mockResolvedValue([rows('p-gone', 10)]),
      findRefs: jest.fn().mockResolvedValue([]),
    } as never;

    const [item] = await new ForecastService(repo, config, noNames).depotRollup({
      depotId: 'dep-1',
      now: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(item).toMatchObject({ productId: 'p-gone', name: null, sku: null, unit: null });
  });

  it('breaks a tie on predicted total by product id, so the order is stable', async () => {
    const repo = {
      listDepotProducts: jest
        .fn()
        .mockResolvedValue([rows('p-b', 10), rows('p-a', 10), rows('p-c', 99)]),
      findRefs: jest.fn().mockResolvedValue([
        { productId: 'p-a', name: 'A', sku: 'SKU-A', unit: 'Galon' },
        { productId: 'p-b', name: 'B', sku: 'SKU-B', unit: 'Galon' },
        { productId: 'p-c', name: 'C', sku: 'SKU-C', unit: 'Galon' },
      ]),
    } as never;

    const items = await new ForecastService(repo, config, noNames).depotRollup({
      depotId: 'dep-1',
      now: new Date('2026-08-01T00:00:00.000Z'),
    });

    const order = items.map((i) => i.productId);
    // p-a and p-b forecast identically; the id decides, so the list never shuffles between runs.
    expect(order.indexOf('p-a')).toBeLessThan(order.indexOf('p-b'));
  });
});

describe('ForecastPrismaRepository.findRevenueRows', () => {
  it('filters on no depot at all, on the null depot, and on one depot', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { depotDailyRevenue: { findMany } } as unknown as PrismaService;
    const repo = new ForecastPrismaRepository(prisma);

    await repo.findRevenueRows({ fromDay: 20_290, toDay: 20_300 });
    await repo.findRevenueRows({ depotId: null, fromDay: 20_290, toDay: 20_300 });
    await repo.findRevenueRows({ depotId: 'dep-1', fromDay: 20_290, toDay: 20_300 });

    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('depotId');
    expect(findMany.mock.calls[1][0].where).toMatchObject({ depotId: null });
    expect(findMany.mock.calls[2][0].where).toMatchObject({ depotId: 'dep-1' });
  });
});

describe('OrderFeedHttpAdapter timestamps', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('falls back updatedAt, then to now, when the order carries no completion time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        orders: [
          { id: 'o1', customerId: 'c1', items: [], updatedAt: '2026-07-31T00:00:00.000Z' },
          { id: 'o2', customerId: 'c1', items: [] },
        ],
        nextCursor: null,
      }),
    }) as never;

    const config = {
      orderServiceUrl: 'http://order',
      internalServiceKey: 'k',
    } as unknown as ForecastConfigService;

    const page = await new OrderFeedHttpAdapter(config).fetchCompleted(null, 50);

    expect(page.orders[0].at).toEqual(new Date('2026-07-31T00:00:00.000Z'));
    expect(page.orders[1].at).toEqual(new Date('2026-08-01T10:00:00.000Z'));
    // No depot and no total on either order: null and 0, never undefined.
    expect(page.orders[0]).toMatchObject({ depotId: null, total: 0 });
  });
});
