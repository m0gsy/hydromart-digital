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
  const productDailySales = { findMany: jest.fn(), groupBy: jest.fn() };

  // Write-path models (accessed via tx.* inside the transaction callback)
  const tx = {
    $executeRaw: jest.fn(),
    productDailySales: { findMany: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
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

  // Audit S-5 and its Q-17 baseline row: one order used to cost three statements per line
  // plus two per product PAIR, all inside one interactive transaction. The count is fixed
  // now, and the statements carry the whole order.
  it('writes the whole order in one round of statements', async () => {
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
    // p-1 has no daily row yet (insert); p-2 already has one (increment).
    tx.productDailySales.findMany.mockResolvedValue([{ id: 'pds-2', productId: 'p-2' }]);

    await repo.applyIngest(cmd);

    const day = new Date(Date.UTC(2026, 0, 15));
    expect($transaction).toHaveBeenCalledTimes(1);
    // purchases + refs + co-buys: three statements for a two-line order, not six.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(tx.productDailySales.findMany).toHaveBeenCalledWith({
      where: { productId: { in: ['p-1', 'p-2'] }, depotId: 'depot-1', day },
      select: { id: true, productId: true },
    });
    expect(tx.productDailySales.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pds-2'] } },
      data: { count: { increment: 1 } },
    });
    expect(tx.productDailySales.createMany).toHaveBeenCalledWith({
      data: [{ productId: 'p-1', depotId: 'depot-1', day, count: 1 }],
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
    tx.productDailySales.findMany.mockResolvedValue([{ id: 'pds-1', productId: 'p-1' }]);
    await repo.applyIngest(cmd);
    // Two statements, not three: purchases and refs, and NO co-buy insert at all.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    // The product bought twice increments by two, exactly as two separate bumps did.
    expect(tx.productDailySales.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pds-1'] } },
      data: { count: { increment: 2 } },
    });
  });

  it('writes nothing but the marker for an order with no lines', async () => {
    await repo.applyIngest({
      orderId: 'ord-3',
      customerId: 'cust-1',
      depotId: null,
      at: new Date('2026-01-15T00:00:00Z'),
      items: [],
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.ingestedOrder.create).toHaveBeenCalledWith({ data: { orderId: 'ord-3' } });
  });

  it('inserts every daily row when the day is empty', async () => {
    tx.productDailySales.findMany.mockResolvedValue([]);
    await repo.applyIngest({
      orderId: 'ord-4',
      customerId: 'cust-1',
      depotId: null,
      at: new Date('2026-01-15T00:00:00Z'),
      items: [{ productId: 'p-9', productName: 'Galon', sku: 'G', unit: 'galon' }],
    });
    expect(tx.productDailySales.updateMany).not.toHaveBeenCalled();
    expect(tx.productDailySales.createMany).toHaveBeenCalledWith({
      data: [{ productId: 'p-9', depotId: null, day: new Date(Date.UTC(2026, 0, 15)), count: 1 }],
    });
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

  // Audit S-18 and its Q-17 baseline row: a year of daily rows used to come back so the
  // service could add them up and keep ten.
  it('groups and limits in SQL', async () => {
    productDailySales.groupBy.mockResolvedValue([{ productId: 'p-1', _sum: { count: 3 } }]);
    const fromDay = new Date('2026-01-01');
    const out = await repo.trendingTotals('depot-1', fromDay, 10);
    expect(out).toEqual([{ productId: 'p-1', score: 3 }]);
    expect(productDailySales.groupBy).toHaveBeenCalledWith({
      by: ['productId'],
      where: { day: { gte: fromDay }, depotId: 'depot-1' },
      _sum: { count: true },
      orderBy: [{ _sum: { count: 'desc' } }, { productId: 'asc' }],
      take: 10,
    });

    // A row with no sum at all reads as zero, never NaN.
    productDailySales.groupBy.mockResolvedValue([{ productId: 'p-2', _sum: { count: null } }]);
    expect(await repo.trendingTotals(null, fromDay, 5)).toEqual([{ productId: 'p-2', score: 0 }]);
    expect(productDailySales.groupBy).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { day: { gte: fromDay } } }),
    );
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
