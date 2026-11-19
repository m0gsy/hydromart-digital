/**
 * Owner decision 2026-11-19: fill "Beli lagi"'s quantity for purchases recorded before the
 * column existed, once, from the order feed.
 *
 * Rows written before flow 7c have no lastQuantity, so the rail adds one for them until the
 * product is bought again. A rebuild could not fill them, because the ingest skips orders it has
 * already seen. This walks the completed-order feed, keeps each customer's LATEST order of each
 * product (by the same rule as ingest: a promo's free row is not what was ordered), and fills
 * only rows that are still empty. A quantity a real ingest wrote is never overwritten.
 */
import { orderedUnitsByProduct } from '../../src/domain/reorder';
import { RebuildService } from '../../src/application/services/rebuild.service';
import { RecommendationService } from '../../src/application/services/recommendation.service';
import { IngestCommand } from '../../src/application/ports/recommendation.repository';
import { RecommendationPrismaRepository } from '../../src/infrastructure/prisma/recommendation.prisma.repository';
import { IngestController } from '../../src/modules/ingest.controller';
import { FakeOrderFeed, FakeRecommendationRepository } from '../support/fakes';

const item = (productId: string, quantity?: number, unitPrice?: number) => ({
  productId,
  productName: productId,
  sku: productId,
  unit: 'galon',
  quantity,
  unitPrice,
});
const order = (orderId: string, customerId: string, at: string, items: ReturnType<typeof item>[]): IngestCommand => ({
  orderId,
  customerId,
  depotId: 'dep-1',
  at: new Date(at),
  items,
});

describe('orderedUnitsByProduct (the one rule ingest and the backfill share)', () => {
  it("sums a product's lines and leaves out a promo's free row beside a paid one", () => {
    expect(
      orderedUnitsByProduct([item('a', 4, 20_000), item('a', 1, 0), item('b', 2, 0), item('c')]),
    ).toEqual(
      new Map([
        ['a', 4],
        ['b', 2], // free with no paid sibling: a free catalog item, which was ordered
        ['c', 1], // no quantity sent: one, as before
      ]),
    );
  });
});

describe('RebuildService.backfillLastQuantity', () => {
  function build(orders: IngestCommand[]) {
    const repo = new FakeRecommendationRepository();
    const service = new RecommendationService(repo, { businessTimeZone: 'Asia/Jakarta' } as never);
    const rebuild = new RebuildService(new FakeOrderFeed(orders), service, repo);
    return { repo, rebuild };
  }

  it("fills each customer's latest quantity, and only where it is still empty", async () => {
    const { repo, rebuild } = build([
      order('o1', 'c1', '2026-11-01T03:00:00Z', [item('a', 6)]),
      order('o2', 'c1', '2026-11-10T03:00:00Z', [item('a', 2), item('a', 1, 0), item('b', 3, 15_000)]),
      order('o3', 'c2', '2026-11-05T03:00:00Z', [item('a', 4)]),
    ]);
    // Rows as they stood before the column: c1/a and c2/a empty, c1/b written by a real ingest.
    repo.purchases.push(
      { customerId: 'c1', productId: 'a', purchaseCount: 2, lastPurchasedAt: new Date('2026-11-10T03:00:00Z'), lastQuantity: null },
      { customerId: 'c1', productId: 'b', purchaseCount: 1, lastPurchasedAt: new Date('2026-11-10T03:00:00Z'), lastQuantity: 9 },
      { customerId: 'c2', productId: 'a', purchaseCount: 1, lastPurchasedAt: new Date('2026-11-05T03:00:00Z'), lastQuantity: null },
    );

    expect(await rebuild.backfillLastQuantity(100)).toEqual({ orders: 3, rows: 2 });
    const q = (c: string, p: string) => repo.purchases.find((r) => r.customerId === c && r.productId === p)?.lastQuantity;
    expect(q('c1', 'a')).toBe(2); // the latest order (o2), its free row left out — not o1's 6
    expect(q('c1', 'b')).toBe(9); // a real ingest's value is never overwritten
    expect(q('c2', 'a')).toBe(4);
  });

  it('reads every page; the order PLACED last wins, whatever its updatedAt says', async () => {
    // The feed pages in placement order. o1 was placed first but touched later (a rating), so
    // its feed time is the newest; o2 is still the customer's latest purchase.
    const { repo, rebuild } = build([
      order('o1', 'c1', '2026-11-15T03:00:00Z', [item('a', 6)]),
      order('o2', 'c1', '2026-11-10T03:00:00Z', [item('a', 2)]),
    ]);
    repo.purchases.push({
      customerId: 'c1', productId: 'a', purchaseCount: 2,
      // A push ingest stamped the row when the request arrived: later than the order's own time.
      lastPurchasedAt: new Date('2026-11-10T03:00:01.200Z'), lastQuantity: null,
    });
    // One order a page.
    expect(await rebuild.backfillLastQuantity(1)).toEqual({ orders: 2, rows: 1 });
    expect(repo.purchases[0].lastQuantity).toBe(2);
  });

  it('an empty feed fills nothing', async () => {
    const { rebuild } = build([]);
    expect(await rebuild.backfillLastQuantity(100)).toEqual({ orders: 0, rows: 0 });
  });
});

describe('the Prisma fill', () => {
  it('writes only rows still empty', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repo = new RecommendationPrismaRepository({ customerProductPurchase: { updateMany } } as never);
    expect(await repo.fillLastQuantity([{ customerId: 'c1', productId: 'a', quantity: 2 }])).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1', productId: 'a', lastQuantity: null },
      data: { lastQuantity: 2 },
    });
  });
});

describe('the internal route', () => {
  it('runs the backfill with the page size asked for', async () => {
    const rebuild = { backfillLastQuantity: jest.fn().mockResolvedValue({ orders: 3, rows: 2 }) };
    const c = new IngestController({} as never, rebuild as never);
    expect(await c.backfillLastQuantity({ limit: 50 } as never)).toEqual({ orders: 3, rows: 2 });
    expect(rebuild.backfillLastQuantity).toHaveBeenCalledWith(50);
    await c.backfillLastQuantity({} as never);
    expect(rebuild.backfillLastQuantity).toHaveBeenLastCalledWith(100);
  });
});
