import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { RecommendationPrismaRepository } from '../../src/infrastructure/prisma/recommendation.prisma.repository';
import { IngestCommand } from '../../src/application/ports/recommendation.repository';

// Unit-tests the recommendation-service Prisma repository against per-model jest.fn() mocks
// of PrismaService. No real database: read methods assert EXACT prisma call args + row
// mapping; applyIngest runs inside a mocked interactive $transaction whose `tx` is bound to a
// separate set of write-model mocks. Mirrors
// services/auth-service/test/unit/prisma-repositories.spec.ts.

describe('RecommendationPrismaRepository', () => {
  // Read-path models (accessed via this.prisma.*)
  const ingestedOrder = { findUnique: jest.fn() };
  const customerProductPurchase = { findMany: jest.fn() };
  const productCoBuy = { findMany: jest.fn() };
  const productRef = { findUnique: jest.fn(), findMany: jest.fn() };
  const productDailySales = { findMany: jest.fn() };

  // Write-path models (accessed via tx.* inside the transaction callback)
  const tx = {
    customerProductPurchase: { upsert: jest.fn() },
    productRef: { upsert: jest.fn() },
    productDailySales: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    productCoBuy: { upsert: jest.fn() },
    ingestedOrder: { create: jest.fn() },
  };
  const $transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx));
  const prisma = {
    ingestedOrder,
    customerProductPurchase,
    productCoBuy,
    productRef,
    productDailySales,
    $transaction,
  } as unknown as PrismaService;
  const repo = new RecommendationPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('reports whether an order was already ingested', async () => {
    ingestedOrder.findUnique.mockResolvedValue({ orderId: 'ord-1' });
    expect(await repo.hasIngested('ord-1')).toBe(true);
    expect(ingestedOrder.findUnique).toHaveBeenCalledWith({ where: { orderId: 'ord-1' } });

    ingestedOrder.findUnique.mockResolvedValue(null);
    expect(await repo.hasIngested('ord-2')).toBe(false);
  });

  it('applies an ingest atomically: purchases, refs, daily sales, co-buys, marker', async () => {
    const cmd: IngestCommand = {
      orderId: 'ord-1',
      customerId: 'cust-1',
      depotId: 'depot-1',
      at: new Date('2026-01-15T10:00:00Z'),
      items: [
        { productId: 'p-1', productName: 'Galon 19L', sku: 'G19', unit: 'galon' },
        { productId: 'p-2', productName: 'Botol 600ml', sku: 'B600', unit: 'botol' },
      ],
    };
    // First item: no existing daily row (create); second item: existing (update).
    tx.productDailySales.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'pds-2' });

    await repo.applyIngest(cmd);

    const day = new Date(Date.UTC(2026, 0, 15));
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.customerProductPurchase.upsert).toHaveBeenCalledTimes(2);
    expect(tx.customerProductPurchase.upsert).toHaveBeenNthCalledWith(1, {
      where: { customerId_productId: { customerId: 'cust-1', productId: 'p-1' } },
      create: { customerId: 'cust-1', productId: 'p-1', purchaseCount: 1, lastPurchasedAt: cmd.at },
      update: { purchaseCount: { increment: 1 }, lastPurchasedAt: cmd.at },
    });
    expect(tx.productRef.upsert).toHaveBeenNthCalledWith(1, {
      where: { productId: 'p-1' },
      create: { productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'galon', buyCount: 1 },
      update: { name: 'Galon 19L', sku: 'G19', unit: 'galon', buyCount: { increment: 1 } },
    });
    // p-1: no existing row -> create with the derived UTC day.
    expect(tx.productDailySales.create).toHaveBeenCalledWith({
      data: { productId: 'p-1', depotId: 'depot-1', day, count: 1 },
    });
    // p-2: existing row -> increment.
    expect(tx.productDailySales.update).toHaveBeenCalledWith({
      where: { id: 'pds-2' },
      data: { count: { increment: 1 } },
    });
    // One unordered pair (p-1, p-2) -> two symmetric co-buy upserts.
    expect(tx.productCoBuy.upsert).toHaveBeenCalledTimes(2);
    expect(tx.productCoBuy.upsert).toHaveBeenNthCalledWith(1, {
      where: { productId_relatedProductId: { productId: 'p-1', relatedProductId: 'p-2' } },
      create: { productId: 'p-1', relatedProductId: 'p-2', coCount: 1 },
      update: { coCount: { increment: 1 } },
    });
    expect(tx.productCoBuy.upsert).toHaveBeenNthCalledWith(2, {
      where: { productId_relatedProductId: { productId: 'p-2', relatedProductId: 'p-1' } },
      create: { productId: 'p-2', relatedProductId: 'p-1', coCount: 1 },
      update: { coCount: { increment: 1 } },
    });
    expect(tx.ingestedOrder.create).toHaveBeenCalledWith({ data: { orderId: 'ord-1' } });
  });

  it('does not co-buy a product with itself when it appears twice in one order', async () => {
    const cmd: IngestCommand = {
      orderId: 'ord-2',
      customerId: 'cust-1',
      depotId: null,
      at: new Date('2026-01-15T00:00:00Z'),
      items: [
        { productId: 'p-1', productName: 'Galon 19L', sku: 'G19', unit: 'galon' },
        { productId: 'p-1', productName: 'Galon 19L', sku: 'G19', unit: 'galon' },
      ],
    };
    tx.productDailySales.findFirst.mockResolvedValue({ id: 'pds-1' });
    await repo.applyIngest(cmd);
    expect(tx.productCoBuy.upsert).not.toHaveBeenCalled();
  });

  it('maps reorder rows for a customer', async () => {
    customerProductPurchase.findMany.mockResolvedValue([
      { productId: 'p-1', purchaseCount: 4, lastPurchasedAt: new Date('2026-01-10'), extra: 'ignored' },
    ]);
    const out = await repo.reorderRows('cust-1');
    expect(out).toEqual([{ productId: 'p-1', purchaseCount: 4, lastPurchasedAt: new Date('2026-01-10') }]);
    expect(customerProductPurchase.findMany).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
  });

  it('returns related co-buy rows plus the base buy count', async () => {
    productCoBuy.findMany.mockResolvedValue([{ relatedProductId: 'p-2', coCount: 7 }]);
    productRef.findUnique.mockResolvedValue({ buyCount: 20 });
    const out = await repo.relatedRows('p-1');
    expect(out).toEqual({ rows: [{ relatedProductId: 'p-2', coCount: 7 }], baseCount: 20 });
    expect(productCoBuy.findMany).toHaveBeenCalledWith({ where: { productId: 'p-1' } });
    expect(productRef.findUnique).toHaveBeenCalledWith({ where: { productId: 'p-1' } });
  });

  it('defaults the base buy count to 0 when the product ref is unknown', async () => {
    productCoBuy.findMany.mockResolvedValue([]);
    productRef.findUnique.mockResolvedValue(null);
    const out = await repo.relatedRows('p-unknown');
    expect(out).toEqual({ rows: [], baseCount: 0 });
  });

  it('lists trending daily rows, scoping by depot when given', async () => {
    productDailySales.findMany.mockResolvedValue([
      { productId: 'p-1', day: new Date('2026-01-15'), count: 3 },
    ]);
    const fromDay = new Date('2026-01-01');
    const out = await repo.trendingRows('depot-1', fromDay);
    expect(out).toEqual([{ productId: 'p-1', day: new Date('2026-01-15'), count: 3 }]);
    expect(productDailySales.findMany).toHaveBeenCalledWith({
      where: { day: { gte: fromDay }, depotId: 'depot-1' },
    });

    await repo.trendingRows(null, fromDay);
    expect(productDailySales.findMany).toHaveBeenLastCalledWith({ where: { day: { gte: fromDay } } });
  });

  it('builds a product-ref map keyed by product id', async () => {
    productRef.findMany.mockResolvedValue([
      { productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'galon' },
      { productId: 'p-2', name: 'Botol', sku: 'B600', unit: 'botol' },
    ]);
    const out = await repo.productRefs(['p-1', 'p-2']);
    expect(out.get('p-1')).toEqual({ name: 'Galon 19L', sku: 'G19', unit: 'galon' });
    expect(out.size).toBe(2);
    expect(productRef.findMany).toHaveBeenCalledWith({ where: { productId: { in: ['p-1', 'p-2'] } } });
  });
});
