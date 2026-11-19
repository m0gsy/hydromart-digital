/**
 * Flow plan PR-7c · "Beli lagi" puts back the quantity the customer last bought.
 *
 * The reorder rail always added ONE, whatever the customer's habit: someone who orders four
 * galons every week tapped "Beli lagi" and got one. The purchase row now keeps the units of
 * the latest order that carried the product, and the reorder answer hands it to the client.
 * Rows written before this column existed have none: the client keeps adding one for them.
 */
import { rankReorder } from '../../src/domain/reorder';
import { RecommendationPrismaRepository } from '../../src/infrastructure/prisma/recommendation.prisma.repository';
import { RecommendationService } from '../../src/application/services/recommendation.service';
import { FakeRecommendationRepository } from '../support/fakes';

const now = new Date('2026-11-19T00:00:00Z');

describe('rankReorder carries the last quantity through', () => {
  it('keeps it beside the score, and leaves it out when the row has none', () => {
    const ranked = rankReorder(
      [
        { productId: 'a', purchaseCount: 3, lastPurchasedAt: now, lastQuantity: 4 },
        { productId: 'b', purchaseCount: 1, lastPurchasedAt: now, lastQuantity: null },
      ],
      now,
      10,
    );
    expect(ranked[0]).toEqual({ productId: 'a', score: expect.any(Number), lastQuantity: 4 });
    expect(ranked[1]).toEqual({ productId: 'b', score: expect.any(Number) });
  });
});

describe('the purchase row keeps the units of the latest order', () => {
  const tx = {
    $executeRaw: jest.fn(),
    productDailySales: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), createMany: jest.fn() },
    ingestedOrder: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    customerProductPurchase: { findMany: jest.fn() },
  };
  const repo = new RecommendationPrismaRepository(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('writes the summed line units into lastQuantity, which a newer order replaces', async () => {
    await repo.applyIngest({
      orderId: 'o-1',
      customerId: 'c-1',
      depotId: null,
      at: now,
      items: [
        { productId: 'p-1', productName: 'A', sku: 'A', unit: 'u', quantity: 3 },
        { productId: 'p-1', productName: 'A', sku: 'A', unit: 'u', quantity: 1 },
        { productId: 'p-2', productName: 'B', sku: 'B', unit: 'u' },
      ],
    });
    const purchases = tx.$executeRaw.mock.calls[1][0] as { sql: string; values: unknown[] };
    expect(purchases.sql).toContain('"lastQuantity"');
    expect(purchases.sql).toMatch(/THEN EXCLUDED\."lastQuantity"/);
    // Per product: purchaseCount 1 (one order), then the units: 4 for p-1, 1 for p-2 (no quantity sent).
    expect(purchases.values.filter((v) => typeof v === 'number')).toEqual([1, 4, 1, 1]);
  });

  it('reads it back, null for a row written before the column', async () => {
    prisma.customerProductPurchase.findMany.mockResolvedValue([
      { productId: 'p-1', purchaseCount: 2, lastPurchasedAt: now, lastQuantity: 4 },
      { productId: 'p-2', purchaseCount: 1, lastPurchasedAt: now, lastQuantity: null },
    ]);
    expect(await repo.reorderRows('c-1')).toEqual([
      { productId: 'p-1', purchaseCount: 2, lastPurchasedAt: now, lastQuantity: 4 },
      { productId: 'p-2', purchaseCount: 1, lastPurchasedAt: now, lastQuantity: null },
    ]);
  });
});

describe('the reorder answer hands it to the client', () => {
  it('on its own reorder items only, never on the trending fallback', async () => {
    const repo = new FakeRecommendationRepository();
    const service = new RecommendationService(repo, { businessTimeZone: 'Asia/Jakarta' } as never);
    const item = (productId: string, quantity?: number) => ({ productId, productName: productId, sku: productId, unit: 'galon', quantity });
    await service.ingest({ orderId: 'o-1', customerId: 'c-1', depotId: 'd-1', at: new Date('2026-11-10T03:00:00Z'), items: [item('a', 2)] });
    await service.ingest({ orderId: 'o-2', customerId: 'c-1', depotId: 'd-1', at: new Date('2026-11-17T03:00:00Z'), items: [item('a', 4), item('b')] });

    const mine = await service.reorder('c-1', 10);
    expect(mine.find((i) => i.productId === 'a')?.lastQuantity).toBe(4);
    expect(mine.find((i) => i.productId === 'b')?.lastQuantity).toBe(1);

    const cold = await service.reorder('nobody', 10);
    expect(cold.length).toBeGreaterThan(0);
    expect(cold.every((i) => i.lastQuantity === undefined)).toBe(true);
  });
});

describe('review round: what "Beli lagi" must not put back', () => {
  const tx = {
    $executeRaw: jest.fn(),
    productDailySales: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), createMany: jest.fn() },
    ingestedOrder: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const repo = new RecommendationPrismaRepository(prisma as never);
  beforeEach(() => jest.clearAllMocks());

  it("a promo's free row is not part of what was ordered — but trending still counts it", async () => {
    await repo.applyIngest({
      orderId: 'o-bogo',
      customerId: 'c-1',
      depotId: null,
      at: now,
      items: [
        { productId: 'p-1', productName: 'A', sku: 'A', unit: 'u', quantity: 4, unitPrice: 20_000 },
        { productId: 'p-1', productName: 'A', sku: 'A', unit: 'u', quantity: 1, unitPrice: 0 },
        // Free with no paid sibling: a genuinely free catalog item, which was ordered.
        { productId: 'p-2', productName: 'B', sku: 'B', unit: 'u', quantity: 2, unitPrice: 0 },
      ],
    });
    const purchases = tx.$executeRaw.mock.calls[1][0] as { values: unknown[] };
    expect(purchases.values.filter((v) => typeof v === 'number')).toEqual([1, 4, 1, 2]);
    expect(tx.productDailySales.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ productId: 'p-1', count: 5 }),
        expect.objectContaining({ productId: 'p-2', count: 2 }),
      ],
    });
  });

  it('an older order ingested late never passes for the latest', async () => {
    await repo.applyIngest({
      orderId: 'o-old',
      customerId: 'c-1',
      depotId: null,
      at: now,
      items: [{ productId: 'p-1', productName: 'A', sku: 'A', unit: 'u', quantity: 6 }],
    });
    const { sql } = tx.$executeRaw.mock.calls[1][0] as { sql: string };
    expect(sql).toMatch(/GREATEST\("customer_product_purchases"\."lastPurchasedAt", EXCLUDED\."lastPurchasedAt"\)/);
    expect(sql).toMatch(/WHEN EXCLUDED\."lastPurchasedAt" >= "customer_product_purchases"\."lastPurchasedAt"/);
  });

  it('the in-memory fake agrees: a late older order leaves the newer quantity', async () => {
    const fake = new FakeRecommendationRepository();
    const service = new RecommendationService(fake, { businessTimeZone: 'Asia/Jakarta' } as never);
    const item = (quantity: number) => ({ productId: 'a', productName: 'a', sku: 'a', unit: 'galon', quantity });
    await service.ingest({ orderId: 'new', customerId: 'c-1', depotId: null, at: new Date('2026-11-17T03:00:00Z'), items: [item(2)] });
    await service.ingest({ orderId: 'old', customerId: 'c-1', depotId: null, at: new Date('2026-11-01T03:00:00Z'), items: [item(6)] });
    expect((await service.reorder('c-1', 10))[0]?.lastQuantity).toBe(2);
  });
});
