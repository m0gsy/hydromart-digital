import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { SubscriptionPrismaRepository } from '../../src/infrastructure/prisma/subscription.prisma.repository';
import { VoucherRejectedError } from '../../src/domain/errors';

// Fills the remaining ternary branches the main prisma-repositories spec doesn't hit:
// sumDepotSales' null-sum fallback and subscription findById's found-row mapping.

const dec = (n: number) => ({ toNumber: () => n });

describe('OrderPrismaRepository.sumDepotSales', () => {
  const order = { aggregate: jest.fn() };
  const repo = new OrderPrismaRepository({ order } as unknown as PrismaService);
  beforeEach(() => jest.clearAllMocks());

  it('rounds the aggregate sum over DELIVERED/COMPLETED orders in range', async () => {
    order.aggregate.mockResolvedValue({ _sum: { total: dec(150000.6) } });
    expect(await repo.sumDepotSales('d1', new Date('2026-01-01'), new Date('2026-02-01'))).toBe(
      150001,
    );
    expect(order.aggregate).toHaveBeenCalledWith({
      _sum: { total: true },
      where: {
        depotId: 'd1',
        status: { in: ['DELIVERED', 'COMPLETED'] },
        createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-02-01') },
      },
    });
  });

  it('returns 0 when no orders matched (null sum)', async () => {
    order.aggregate.mockResolvedValue({ _sum: { total: null } });
    expect(await repo.sumDepotSales('d1', new Date('2026-01-01'), new Date('2026-02-01'))).toBe(0);
  });
});

describe('SubscriptionPrismaRepository.findById', () => {
  const subscription = { findUnique: jest.fn() };
  const repo = new SubscriptionPrismaRepository({ subscription } as unknown as PrismaService);

  it('maps the row to a record when the subscription exists', async () => {
    subscription.findUnique.mockResolvedValue({
      id: 's1',
      customerId: 'c1',
      productId: 'p1',
      productName: 'Galon 19L',
      unit: 'Galon',
      quantity: 2,
      frequency: 'WEEKLY',
      status: 'ACTIVE',
      nextDeliveryAt: new Date('2026-05-01'),
      recipientName: 'Budi',
      phone: '0811',
      addressLine: 'Jl 1',
      city: 'Bandung',
      province: 'Jabar',
      postalCode: null,
      latitude: null,
      longitude: null,
      notes: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    });
    const out = await repo.findById('s1');
    expect(out).toMatchObject({ id: 's1', frequency: 'WEEKLY', status: 'ACTIVE', quantity: 2 });
    expect(subscription.findUnique).toHaveBeenCalledWith({ where: { id: 's1' } });
  });
});

// The main prisma spec exercises the report queries with an EMPTY range, leaving the
// `range.from ? gte` / `range.to ? lt` / `range.from || range.to` truthy branches (in
// reportWhere and the raw-SQL cond builders) unhit. Re-running each with a bounded window
// flips exactly those branches; the returned rows are irrelevant here (empty is fine).
describe('OrderPrismaRepository report range filters (bounded-window branches)', () => {
  const order = { groupBy: jest.fn().mockResolvedValue([]) };
  const orderItem = { groupBy: jest.fn().mockResolvedValue([]) };
  const $queryRaw = jest.fn().mockResolvedValue([]);
  const repo = new OrderPrismaRepository({
    order,
    orderItem,
    $queryRaw,
  } as unknown as PrismaService);
  const from = new Date('2026-01-01');
  const to = new Date('2026-02-01');

  it('applies gte+lt to reportWhere-backed reports', async () => {
    await repo.topCustomers({ from, to }, 5);
    await repo.topDepots({ from, to }, 5);
    await repo.shippingByDepot({ from, to });
    await repo.revenueByProduct({ from, to }, 10);
    const where = order.groupBy.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: from, lt: to });
  });

  it('applies the to-only bound to the refunds inline window', async () => {
    await repo.refundsByDepot({ to });
    const where = order.groupBy.mock.calls.at(-1)?.[0].where;
    expect(where.createdAt).toEqual({ lt: to });
  });

  it('pushes both raw-SQL date conds for rating/retention reports', async () => {
    await repo.ratingByDepot({ from, to });
    await repo.depotRatings('d1', { from, to });
    await repo.retentionCohort({ from, to });
    expect($queryRaw).toHaveBeenCalled();
  });
});

// The other half of the same ternaries: an aggregate over zero rows returns a null _sum, and
// an unbounded report window must not push a createdAt filter at all.
describe('OrderPrismaRepository empty-aggregate and unbounded-window branches', () => {
  const order = {
    groupBy: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  };
  const orderReview = { findUnique: jest.fn() };
  const repo = new OrderPrismaRepository({
    order,
    orderReview,
  } as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('reads zero revenue from a depot rollup with no matching orders', async () => {
    order.groupBy.mockResolvedValue([
      { depotId: 'd1', _count: { _all: 0 }, _sum: { total: null, deliveryFee: null } },
    ]);
    expect((await repo.topDepots({}, 5))[0].revenue).toBe(0);
    expect((await repo.shippingByDepot({}))[0].shippingBilled).toBe(0);
  });

  it('reads zero lifetime revenue for a customer who never ordered', async () => {
    order.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { total: null },
      _min: { createdAt: null },
      _max: { createdAt: null },
    });
    expect(await repo.customerLifetime('c1')).toMatchObject({ revenue: 0, firstOrderAt: null });
  });

  it('omits createdAt entirely from an unbounded refund rollup and depot order list', async () => {
    await repo.refundsByDepot({});
    expect(order.groupBy.mock.calls.at(-1)?.[0].where.createdAt).toBeUndefined();
    await repo.ordersForDepot('d1', {});
    expect(order.findMany.mock.calls.at(-1)?.[0].where.createdAt).toBeUndefined();
  });

  it('applies a one-sided window to a depot order list', async () => {
    const from = new Date('2026-01-01');
    await repo.ordersForDepot('d1', { from });
    expect(order.findMany.mock.calls.at(-1)?.[0].where.createdAt).toEqual({ gte: from });
    const to = new Date('2026-02-01');
    await repo.ordersForDepot('d1', { to });
    expect(order.findMany.mock.calls.at(-1)?.[0].where.createdAt).toEqual({ lt: to });
  });

  it('maps a review that exists', async () => {
    orderReview.findUnique.mockResolvedValue({
      id: 'r1',
      orderId: 'o1',
      customerId: 'c1',
      rating: 5,
      aspects: [],
      comment: null,
      tipAmount: 0,
      createdAt: new Date('2026-01-01'),
    });
    expect(await repo.findReviewByOrderId('o1')).toMatchObject({ id: 'r1', rating: 5 });
  });

  it('writes only the courier fields it was actually given', async () => {
    order.update.mockResolvedValue({
      id: 'o1',
      subtotal: dec(20000),
      deliveryFee: dec(5000),
      discount: dec(0),
      total: dec(25000),
      refundedAmount: null,
      items: [],
      history: [],
    });
    await repo.applyStatus(
      'o1',
      'ON_DELIVERY' as never,
      'DRIVER_ASSIGNED' as never,
      'staff',
      null,
      'Budi',
      null,
      null,
    );
    const data = order.update.mock.calls.at(-1)?.[0].data;
    expect(data).toMatchObject({ driverName: 'Budi' });
    expect(data.driverPhone).toBeUndefined();
    expect(data.estimatedArrivalAt).toBeUndefined();
  });
});

describe('VoucherRejectedError', () => {
  it('defaults to a generic message when constructed with no argument', () => {
    expect(new VoucherRejectedError().message).toBe('This voucher could not be applied.');
    expect(new VoucherRejectedError('custom').message).toBe('custom');
  });
});
