import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ForecastPrismaRepository } from '../../src/infrastructure/prisma/forecast.prisma.repository';
import { IngestCommand } from '../../src/application/ports/forecast.repository';
import { toUtcDay } from '../../src/domain/series';

// Unit-tests the forecast-service Prisma repository against per-model jest.fn() mocks of
// PrismaService. No real database: read methods assert EXACT prisma call args + row mapping
// (epoch-day conversion); applyIngest runs inside a mocked interactive $transaction whose
// `tx` is bound to a separate set of write-model mocks. Mirrors
// services/auth-service/test/unit/prisma-repositories.spec.ts.

const MS_PER_DAY = 86_400_000;
const dayToDate = (day: number) => new Date(day * MS_PER_DAY);

describe('ForecastPrismaRepository', () => {
  // Read-path models (this.prisma.*)
  const ingestedOrder = { findUnique: jest.fn() };
  const productDailyDemand = { findMany: jest.fn() };
  const productRef = { findMany: jest.fn() };
  const depotDailyRevenue = { findMany: jest.fn() };
  const customerActivity = { findMany: jest.fn() };

  // Write-path models (tx.* inside the transaction callback)
  const tx = {
    ingestedOrder: { findUnique: jest.fn(), create: jest.fn() },
    productRef: { upsert: jest.fn() },
    productDailyDemand: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    depotDailyRevenue: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    customerActivity: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const $transaction = jest.fn((cb: (t: unknown) => unknown) => cb(tx));
  const prisma = {
    ingestedOrder,
    productDailyDemand,
    productRef,
    depotDailyRevenue,
    customerActivity,
    $transaction,
  } as unknown as PrismaService;
  const repo = new ForecastPrismaRepository(prisma);

  const at = new Date('2026-01-15T10:00:00Z');
  const day = dayToDate(toUtcDay(at)); // UTC-midnight bucket for `at`

  beforeEach(() => jest.clearAllMocks());

  it('reports whether an order was already ingested', async () => {
    ingestedOrder.findUnique.mockResolvedValue({ orderId: 'ord-1' });
    expect(await repo.hasIngested('ord-1')).toBe(true);
    ingestedOrder.findUnique.mockResolvedValue(null);
    expect(await repo.hasIngested('ord-2')).toBe(false);
  });

  it('applies an ingest atomically (create branches) and increments revenue/activity', async () => {
    const cmd: IngestCommand = {
      orderId: 'ord-1',
      customerId: 'cust-1',
      depotId: 'depot-1',
      total: 150000,
      at,
      items: [
        { productId: 'p-1', productName: 'Galon 19L', sku: 'G19', unit: 'galon', quantity: 3 },
        { productId: 'p-2', productName: 'Botol 600ml', sku: 'B600', unit: 'botol', quantity: 2 },
      ],
    };
    tx.ingestedOrder.findUnique.mockResolvedValue(null);
    tx.productDailyDemand.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'pdd-2' });
    tx.depotDailyRevenue.findFirst.mockResolvedValue(null);
    tx.customerActivity.findUnique.mockResolvedValue(null);

    await repo.applyIngest(cmd);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(tx.productRef.upsert).toHaveBeenNthCalledWith(1, {
      where: { productId: 'p-1' },
      create: { productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'galon' },
      update: { name: 'Galon 19L', sku: 'G19', unit: 'galon' },
    });
    // p-1: no existing demand row -> create with item quantity + orderCount 1.
    expect(tx.productDailyDemand.create).toHaveBeenCalledWith({
      data: { productId: 'p-1', depotId: 'depot-1', day, quantity: 3, orderCount: 1 },
    });
    // p-2: existing demand row -> increment by item quantity.
    expect(tx.productDailyDemand.update).toHaveBeenCalledWith({
      where: { id: 'pdd-2' },
      data: { quantity: { increment: 2 }, orderCount: { increment: 1 } },
    });
    // No existing revenue row -> create with the order total.
    expect(tx.depotDailyRevenue.create).toHaveBeenCalledWith({
      data: { depotId: 'depot-1', day, revenue: 150000, orderCount: 1 },
    });
    // New customer -> create snapshot, lastOrderAt = at.
    expect(tx.customerActivity.upsert).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      create: { customerId: 'cust-1', depotId: 'depot-1', lastOrderAt: at, orderCount: 1, totalSpent: 150000 },
      update: { depotId: 'depot-1', lastOrderAt: at, orderCount: { increment: 1 }, totalSpent: { increment: 150000 } },
    });
    expect(tx.ingestedOrder.create).toHaveBeenCalledWith({ data: { orderId: 'ord-1' } });
  });

  it('is a no-op when the order was already ingested (idempotency guard)', async () => {
    tx.ingestedOrder.findUnique.mockResolvedValue({ orderId: 'ord-1' });
    await repo.applyIngest({
      orderId: 'ord-1',
      customerId: 'cust-1',
      depotId: 'depot-1',
      total: 150000,
      at,
      items: [{ productId: 'p-1', productName: 'Galon 19L', sku: 'G19', unit: 'galon', quantity: 3 }],
    });
    expect(tx.productRef.upsert).not.toHaveBeenCalled();
    expect(tx.ingestedOrder.create).not.toHaveBeenCalled();
  });

  it('keeps the max lastOrderAt on the update branch when the existing activity is newer', async () => {
    const newer = new Date('2026-02-01T00:00:00Z');
    tx.ingestedOrder.findUnique.mockResolvedValue(null);
    tx.productDailyDemand.findFirst.mockResolvedValue({ id: 'pdd-1' });
    tx.depotDailyRevenue.findFirst.mockResolvedValue({ id: 'ddr-1' });
    tx.customerActivity.findUnique.mockResolvedValue({ lastOrderAt: newer });

    await repo.applyIngest({
      orderId: 'ord-2',
      customerId: 'cust-1',
      depotId: 'depot-1',
      total: 50000,
      at, // older than `newer`
      items: [{ productId: 'p-1', productName: 'Galon 19L', sku: 'G19', unit: 'galon', quantity: 1 }],
    });

    expect(tx.depotDailyRevenue.update).toHaveBeenCalledWith({
      where: { id: 'ddr-1' },
      data: { revenue: { increment: 50000 }, orderCount: { increment: 1 } },
    });
    expect(tx.customerActivity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ lastOrderAt: newer }) }),
    );
  });

  it('finds demand rows and maps day back to an epoch day number', async () => {
    const rowDay = new Date('2026-01-15T00:00:00Z');
    productDailyDemand.findMany.mockResolvedValue([
      { productId: 'p-1', depotId: 'depot-1', day: rowDay, quantity: 3 },
    ]);
    const out = await repo.findDemandRows({ productId: 'p-1', depotId: 'depot-1', fromDay: 20000, toDay: 20010 });
    expect(out).toEqual([{ productId: 'p-1', depotId: 'depot-1', day: toUtcDay(rowDay), quantity: 3 }]);
    expect(productDailyDemand.findMany).toHaveBeenCalledWith({
      where: {
        productId: 'p-1',
        day: { gte: dayToDate(20000), lte: dayToDate(20010) },
        depotId: 'depot-1',
      },
    });
  });

  it('omits the depot filter when depotId is undefined (all depots)', async () => {
    productDailyDemand.findMany.mockResolvedValue([]);
    await repo.findDemandRows({ productId: 'p-1', fromDay: 20000, toDay: 20010 });
    expect(productDailyDemand.findMany).toHaveBeenCalledWith({
      where: { productId: 'p-1', day: { gte: dayToDate(20000), lte: dayToDate(20010) } },
    });
  });

  it('filters on the null depot explicitly when depotId is null', async () => {
    productDailyDemand.findMany.mockResolvedValue([]);
    await repo.findDemandRows({ productId: 'p-1', depotId: null, fromDay: 20000, toDay: 20010 });
    expect(productDailyDemand.findMany).toHaveBeenCalledWith({
      where: { productId: 'p-1', day: { gte: dayToDate(20000), lte: dayToDate(20010) }, depotId: null },
    });
  });

  it('groups depot products by product id', async () => {
    productDailyDemand.findMany.mockResolvedValue([
      { productId: 'p-1', depotId: 'depot-1', day: new Date('2026-01-15T00:00:00Z'), quantity: 3 },
      { productId: 'p-1', depotId: 'depot-1', day: new Date('2026-01-16T00:00:00Z'), quantity: 4 },
      { productId: 'p-2', depotId: 'depot-1', day: new Date('2026-01-15T00:00:00Z'), quantity: 1 },
    ]);
    const out = await repo.listDepotProducts({ depotId: 'depot-1', fromDay: 20000, toDay: 20010 });
    expect(out).toHaveLength(2);
    expect(out[0].productId).toBe('p-1');
    expect(out[0].rows).toHaveLength(2);
    expect(out[1].productId).toBe('p-2');
    expect(productDailyDemand.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', day: { gte: dayToDate(20000), lte: dayToDate(20010) } },
    });
  });

  it('finds product refs for a set of ids', async () => {
    productRef.findMany.mockResolvedValue([{ productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'galon' }]);
    const out = await repo.findRefs(['p-1', 'p-2']);
    expect(out).toEqual([{ productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'galon' }]);
    expect(productRef.findMany).toHaveBeenCalledWith({ where: { productId: { in: ['p-1', 'p-2'] } } });
  });

  it('finds revenue rows and maps day to an epoch day number', async () => {
    const rowDay = new Date('2026-01-15T00:00:00Z');
    depotDailyRevenue.findMany.mockResolvedValue([{ depotId: 'depot-1', day: rowDay, revenue: 150000 }]);
    const out = await repo.findRevenueRows({ depotId: 'depot-1', fromDay: 20000, toDay: 20010 });
    expect(out).toEqual([{ depotId: 'depot-1', day: toUtcDay(rowDay), revenue: 150000 }]);
    expect(depotDailyRevenue.findMany).toHaveBeenCalledWith({
      where: { day: { gte: dayToDate(20000), lte: dayToDate(20010) }, depotId: 'depot-1' },
    });
  });

  it('lists customer activity oldest-first, capped at the limit', async () => {
    const lastOrderAt = new Date('2026-01-10T00:00:00Z');
    customerActivity.findMany.mockResolvedValue([
      { customerId: 'cust-1', depotId: 'depot-1', lastOrderAt, orderCount: 5, totalSpent: 500000 },
    ]);
    const out = await repo.listCustomerActivity({ depotId: 'depot-1', limit: 25 });
    expect(out).toEqual([
      { customerId: 'cust-1', depotId: 'depot-1', lastOrderAt, orderCount: 5, totalSpent: 500000 },
    ]);
    expect(customerActivity.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1' },
      orderBy: { lastOrderAt: 'asc' },
      take: 25,
    });
  });

  it('omits the depot filter for activity when depotId is undefined', async () => {
    customerActivity.findMany.mockResolvedValue([]);
    await repo.listCustomerActivity({ limit: 10 });
    expect(customerActivity.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { lastOrderAt: 'asc' },
      take: 10,
    });
  });
});
