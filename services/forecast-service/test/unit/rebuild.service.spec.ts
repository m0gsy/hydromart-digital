import { ForecastService } from '../../src/application/services/forecast.service';
import { RebuildService } from '../../src/application/services/rebuild.service';
import { OrderFeedPort } from '../../src/application/ports/order-feed.port';
import { IngestCommand } from '../../src/application/ports/forecast.repository';
import { FakeForecastRepository } from '../support/fakes';

/** In-memory OrderFeedPort: paginates a fixed order list by index cursor (same shape as the HTTP adapter). */
class FakeOrderFeed implements OrderFeedPort {
  calls = 0;
  constructor(public orders: IngestCommand[] = []) {}

  async fetchCompleted(cursor: string | null, limit: number): Promise<{ orders: IngestCommand[]; nextCursor: string | null }> {
    this.calls += 1;
    const start = cursor ? Number(cursor) : 0;
    const page = this.orders.slice(start, start + limit);
    const end = start + page.length;
    return { orders: page, nextCursor: end < this.orders.length ? String(end) : null };
  }
}

function makeIngest(orderId: string): IngestCommand {
  return {
    orderId,
    depotId: 'depot-1',
    at: new Date('2026-07-11T10:00:00Z'),
    items: [
      { productId: 'a', productName: 'Aqua 19L', sku: 'AQ19', unit: 'galon', quantity: 2 },
      { productId: 'b', productName: 'Le Minerale 19L', sku: 'LM19', unit: 'galon', quantity: 1 },
    ],
  };
}

describe('RebuildService', () => {
  let repo: FakeForecastRepository;
  let forecasts: ForecastService;
  let feed: FakeOrderFeed;
  let rebuild: RebuildService;

  // 3 orders, page size 2 → page1 (2 orders) + page2 (1 order, nextCursor null).
  const orders = [makeIngest('order-1'), makeIngest('order-2'), makeIngest('order-3')];

  beforeEach(() => {
    repo = new FakeForecastRepository();
    forecasts = new ForecastService(repo);
    feed = new FakeOrderFeed(orders);
    rebuild = new RebuildService(feed, forecasts);
  });

  it('pages the feed and ingests every order', async () => {
    const result = await rebuild.rebuild(2);

    expect(result).toEqual({ ingested: 3, pages: 2 });
    expect(feed.calls).toBe(2); // two pages, stopped on nextCursor null
    expect(repo.ingestedOrderIds.size).toBe(3);
    // quantities landed once each (2 orders * qty 2 for product a on the same day = 4... but here
    // all 3 orders share the same day/depot/product, so product a = 3 orders * qty 2 = 6).
    const cellA = [...repo.cells.values()].find((c) => c.productId === 'a');
    expect(cellA?.quantity).toBe(6);
    expect(cellA?.orderCount).toBe(3);
  });

  it('is idempotent on re-run: no net-new orders, aggregates unchanged', async () => {
    await rebuild.rebuild(2);
    const secondRun = await rebuild.rebuild(2);

    // The guard means the read model does not grow on the second pass.
    expect(repo.ingestedOrderIds.size).toBe(3);
    const cellA = [...repo.cells.values()].find((c) => c.productId === 'a');
    expect(cellA?.quantity).toBe(6); // not doubled
    expect(cellA?.orderCount).toBe(3);
    // Return shape is stable (orders are still pulled/counted, just re-ingested as no-ops).
    expect(secondRun).toEqual({ ingested: 3, pages: 2 });
  });

  it('clamps limit and returns a single page when it fits', async () => {
    const result = await rebuild.rebuild(999); // clamped to <= 500, still one page for 3 orders

    expect(result).toEqual({ ingested: 3, pages: 1 });
    expect(repo.ingestedOrderIds.size).toBe(3);
  });
});
