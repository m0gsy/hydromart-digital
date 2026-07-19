import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CartPrismaRepository } from '../../src/infrastructure/prisma/cart.prisma.repository';
import { SubscriptionPrismaRepository } from '../../src/infrastructure/prisma/subscription.prisma.repository';
import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { OrderStatus } from '../../src/domain/order-status';
import { CreateOrderData } from '../../src/application/ports/order.repository';

// Unit-tests the order-service Prisma repositories against per-model jest.fn() mocks of
// PrismaService. No real database, no testcontainers: each test asserts the EXACT prisma
// call args and the row->record (money) mapping. Mirrors
// services/auth-service/test/unit/prisma-repositories.spec.ts.

/** Prisma Decimal stand-in: only .toNumber() is consumed by the mappers. */
const dec = (n: number) => ({ toNumber: () => n });

describe('CartPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  };
  const prisma = { cartItem: model } as unknown as PrismaService;
  const repo = new CartPrismaRepository(prisma);
  const row = { id: 'ci-1', customerId: 'cust-1', productId: 'p-1', quantity: 2 };

  beforeEach(() => jest.clearAllMocks());

  it('lists a customer cart oldest-first', async () => {
    model.findMany.mockResolvedValue([row]);
    expect(await repo.findByCustomer('cust-1')).toEqual([row]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('finds one item by the compound key, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findItem('cust-1', 'p-1')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { customerId_productId: { customerId: 'cust-1', productId: 'p-1' } },
    });
  });

  it('upserts quantity by the compound key', async () => {
    model.upsert.mockResolvedValue(row);
    expect(await repo.upsert('cust-1', 'p-1', 3)).toEqual(row);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { customerId_productId: { customerId: 'cust-1', productId: 'p-1' } },
      create: { customerId: 'cust-1', productId: 'p-1', quantity: 3 },
      update: { quantity: 3 },
    });
  });

  it('removes one product and clears the whole cart', async () => {
    await repo.remove('cust-1', 'p-1');
    expect(model.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'cust-1', productId: 'p-1' } });
    await repo.clear('cust-1');
    expect(model.deleteMany).toHaveBeenLastCalledWith({ where: { customerId: 'cust-1' } });
  });
});

describe('SubscriptionPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  };
  const prisma = { subscription: model } as unknown as PrismaService;
  const repo = new SubscriptionPrismaRepository(prisma);
  const row = {
    id: 'sub-1',
    customerId: 'cust-1',
    productId: 'p-1',
    productName: 'Galon 19L',
    unit: 'galon',
    quantity: 2,
    frequency: 'WEEKLY',
    status: 'ACTIVE',
    nextDeliveryAt: new Date('2026-02-01'),
    recipientName: 'Budi',
    phone: '+62800',
    addressLine: 'Jl. Air 1',
    city: 'Jakarta',
    province: 'DKI',
    postalCode: null,
    latitude: null,
    longitude: null,
    notes: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates and maps frequency/status to the union types', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create({
      customerId: 'cust-1',
      productId: 'p-1',
      productName: 'Galon 19L',
      unit: 'galon',
      quantity: 2,
      frequency: 'WEEKLY',
      nextDeliveryAt: row.nextDeliveryAt,
      recipientName: 'Budi',
      phone: '+62800',
      addressLine: 'Jl. Air 1',
      city: 'Jakarta',
      province: 'DKI',
      postalCode: null,
      latitude: null,
      longitude: null,
      notes: null,
    });
    expect(out.frequency).toBe('WEEKLY');
    expect(out.status).toBe('ACTIVE');
    expect(model.create).toHaveBeenCalledWith({ data: expect.objectContaining({ productId: 'p-1' }) });
  });

  it('finds by id, null on miss', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'nope' } });
  });

  it('lists a customer subscriptions newest-first', async () => {
    model.findMany.mockResolvedValue([row]);
    const out = await repo.listByCustomer('cust-1');
    expect(out).toHaveLength(1);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('finds ACTIVE subscriptions due at or before now', async () => {
    model.findMany.mockResolvedValue([row]);
    const now = new Date('2026-02-01');
    await repo.findDue(now);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', nextDeliveryAt: { lte: now } },
      orderBy: { nextDeliveryAt: 'asc' },
    });
  });

  it('sets status and advances the next delivery date', async () => {
    model.update.mockResolvedValue(row);
    await repo.setStatus('sub-1', 'PAUSED');
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'sub-1' }, data: { status: 'PAUSED' } });
    const next = new Date('2026-02-08');
    await repo.advance('sub-1', next);
    expect(model.update).toHaveBeenLastCalledWith({ where: { id: 'sub-1' }, data: { nextDeliveryAt: next } });
  });

  it('summarizes the active network, sorted by subscriber count desc', async () => {
    model.groupBy.mockResolvedValue([
      { productName: 'Galon 19L', frequency: 'WEEKLY', _count: { _all: 2 } },
      { productName: 'Botol 600ml', frequency: 'MONTHLY', _count: { _all: 5 } },
    ]);
    model.findMany.mockResolvedValue([{ customerId: 'cust-1' }, { customerId: 'cust-2' }]);
    const out = await repo.networkSummary();
    expect(out.activeSubscriptions).toBe(7);
    expect(out.activeSubscribers).toBe(2);
    expect(out.plans[0].subscribers).toBe(5); // sorted desc
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['productName', 'frequency'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
    });
    expect(model.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      distinct: ['customerId'],
      select: { customerId: true },
    });
  });
});

describe('OrderPrismaRepository', () => {
  const order = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  };
  const orderReview = { create: jest.fn(), findUnique: jest.fn(), aggregate: jest.fn() };
  const orderItem = { groupBy: jest.fn() };
  const $queryRaw = jest.fn();
  const prisma = {
    order,
    orderReview,
    orderItem,
    $queryRaw,
  } as unknown as PrismaService;
  const repo = new OrderPrismaRepository(prisma);

  const orderRow = () => ({
    id: 'ord-1',
    orderNumber: 'ORD-0001',
    customerId: 'cust-1',
    depotId: 'depot-1',
    status: 'CREATED',
    subtotal: dec(100000),
    deliveryFee: dec(5000),
    discount: dec(2000),
    total: dec(103000),
    recipientName: 'Budi',
    phone: '+62800',
    addressLine: 'Jl. Air 1',
    city: 'Jakarta',
    province: 'DKI',
    postalCode: '12345',
    latitude: -6.2,
    longitude: 106.8,
    notes: null,
    deliveryWindow: null,
    driverName: null,
    items: [
      {
        id: 'it-1',
        productId: 'p-1',
        productName: 'Galon 19L',
        sku: 'G19',
        unit: 'galon',
        unitPrice: dec(20000),
        quantity: 5,
        lineTotal: dec(100000),
      },
    ],
    history: [{ status: 'CREATED', changedBy: null, note: null, createdAt: new Date('2026-01-01') }],
    review: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  const createData: CreateOrderData = {
    orderNumber: 'ORD-0001',
    customerId: 'cust-1',
    depotId: 'depot-1',
    subtotal: 100000,
    deliveryFee: 5000,
    discount: 2000,
    total: 103000,
    recipientName: 'Budi',
    phone: '+62800',
    addressLine: 'Jl. Air 1',
    city: 'Jakarta',
    province: 'DKI',
    postalCode: '12345',
    latitude: -6.2,
    longitude: 106.8,
    notes: null,
    items: [
      {
        productId: 'p-1',
        productName: 'Galon 19L',
        sku: 'G19',
        unit: 'galon',
        unitPrice: 20000,
        quantity: 5,
        lineTotal: 100000,
      },
    ],
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates an order (status CREATED + seeded history) and maps money to numbers', async () => {
    order.create.mockResolvedValue(orderRow());
    const out = await repo.create(createData);
    expect(out.total).toBe(103000);
    expect(out.subtotal).toBe(100000);
    expect(out.discount).toBe(2000);
    expect(out.items[0].lineTotal).toBe(100000);
    expect(out.items[0].unitPrice).toBe(20000);
    expect(out.reviewed).toBe(false);
    expect(out.status).toBe(OrderStatus.CREATED);
    expect(order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderNumber: 'ORD-0001',
        status: OrderStatus.CREATED,
        items: { create: createData.items },
        history: { create: { status: OrderStatus.CREATED } },
      }),
      include: expect.any(Object),
    });
  });

  it('passes through a pre-generated id when supplied', async () => {
    order.create.mockResolvedValue(orderRow());
    await repo.create({ ...createData, id: 'preset-id' });
    expect(order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'preset-id' }),
      include: expect.any(Object),
    });
  });

  it('finds an order by id, mapping reviewed=true when a review row exists', async () => {
    order.findUnique.mockResolvedValue({ ...orderRow(), review: { id: 'rev-1' } });
    const out = await repo.findById('ord-1');
    expect(out?.reviewed).toBe(true);
    expect(order.findUnique).toHaveBeenCalledWith({ where: { id: 'ord-1' }, include: expect.any(Object) });
  });

  it('returns null when the order is not found', async () => {
    order.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('searches with filters, pagination and count', async () => {
    order.findMany.mockResolvedValue([orderRow()]);
    order.count.mockResolvedValue(1);
    const out = await repo.search({
      customerId: 'cust-1',
      status: OrderStatus.CREATED,
      depotId: 'depot-1',
      page: 2,
      limit: 10,
    });
    expect(out.total).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(order.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', status: OrderStatus.CREATED, depotId: 'depot-1' },
      include: expect.any(Object),
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(order.count).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', status: OrderStatus.CREATED, depotId: 'depot-1' },
    });
  });

  it('searches with an empty where when no filters are given', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await repo.search({ page: 1, limit: 20 });
    expect(order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, skip: 0, take: 20 }));
  });

  it('finds stale CREATED orders before a cutoff', async () => {
    order.findMany.mockResolvedValue([orderRow()]);
    const before = new Date('2026-01-05');
    await repo.findStaleCreated(before);
    expect(order.findMany).toHaveBeenCalledWith({
      where: { status: OrderStatus.CREATED, createdAt: { lt: before } },
      include: expect.any(Object),
    });
  });

  it('pages COMPLETED orders from the start (no cursor)', async () => {
    order.findMany.mockResolvedValue([orderRow()]);
    const out = await repo.findCompletedPage(null, 5);
    expect(out.nextCursor).toBeNull();
    expect(out.orders).toHaveLength(1);
    expect(order.findUnique).not.toHaveBeenCalled();
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 6, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('pages COMPLETED orders from a cursor and reports the next cursor when there is more', async () => {
    order.findUnique.mockResolvedValue({ createdAt: new Date('2026-01-01'), id: 'ord-0' });
    const rows = [orderRow(), { ...orderRow(), id: 'ord-2' }];
    order.findMany.mockResolvedValue(rows);
    const out = await repo.findCompletedPage('ord-0', 1);
    expect(out.orders).toHaveLength(1);
    expect(out.nextCursor).toBe('ord-2');
    expect(order.findUnique).toHaveBeenCalledWith({
      where: { id: 'ord-0' },
      select: { createdAt: true, id: true },
    });
  });

  it('applies a status transition and appends history (no driver name)', async () => {
    order.update.mockResolvedValue({ ...orderRow(), status: 'CONFIRMED' });
    const out = await repo.applyStatus('ord-1', OrderStatus.CONFIRMED, 'admin-1', 'ok');
    expect(out.status).toBe(OrderStatus.CONFIRMED);
    expect(order.update).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: {
        status: OrderStatus.CONFIRMED,
        history: { create: { status: OrderStatus.CONFIRMED, changedBy: 'admin-1', note: 'ok' } },
      },
      include: expect.any(Object),
    });
  });

  it('sets the driver name when provided', async () => {
    order.update.mockResolvedValue({ ...orderRow(), driverName: 'Joko', status: 'DRIVER_ASSIGNED' });
    await repo.applyStatus('ord-1', OrderStatus.DRIVER_ASSIGNED, null, null, 'Joko');
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ driverName: 'Joko' }) }),
    );
  });

  it('finds reorder-reminder targets (latest order older than cutoff)', async () => {
    order.groupBy.mockResolvedValue([
      { customerId: 'cust-old', _max: { createdAt: new Date('2025-12-01') } },
      { customerId: 'cust-new', _max: { createdAt: new Date('2026-01-10') } },
      { customerId: 'cust-null', _max: { createdAt: null } },
    ]);
    order.findMany.mockResolvedValue([{ customerId: 'cust-old', phone: '+62800', recipientName: 'Budi' }]);
    const cutoff = new Date('2026-01-01');
    const out = await repo.findReorderReminderTargets(cutoff, 10);
    expect(out).toEqual([{ customerId: 'cust-old', phone: '+62800', recipientName: 'Budi' }]);
    expect(order.findMany).toHaveBeenCalledWith({
      where: { customerId: { in: ['cust-old'] } },
      orderBy: { createdAt: 'desc' },
      distinct: ['customerId'],
      select: { customerId: true, phone: true, recipientName: true },
    });
  });

  it('returns [] and skips the snapshot query when nobody is due', async () => {
    order.groupBy.mockResolvedValue([{ customerId: 'cust-new', _max: { createdAt: new Date('2026-06-01') } }]);
    expect(await repo.findReorderReminderTargets(new Date('2026-01-01'), 10)).toEqual([]);
    expect(order.findMany).not.toHaveBeenCalled();
  });

  it('creates and maps a review', async () => {
    const reviewRow = {
      id: 'rev-1',
      orderId: 'ord-1',
      customerId: 'cust-1',
      rating: 5,
      aspects: ['fast'],
      comment: 'great',
      tipAmount: 5000,
      createdAt: new Date('2026-01-02'),
    };
    orderReview.create.mockResolvedValue(reviewRow);
    const out = await repo.createReview({
      orderId: 'ord-1',
      customerId: 'cust-1',
      rating: 5,
      aspects: ['fast'],
      comment: 'great',
      tipAmount: 5000,
    });
    expect(out.rating).toBe(5);
    expect(out.tipAmount).toBe(5000);
    expect(orderReview.create).toHaveBeenCalledWith({
      data: {
        orderId: 'ord-1',
        customerId: 'cust-1',
        rating: 5,
        aspects: ['fast'],
        comment: 'great',
        tipAmount: 5000,
      },
    });
  });

  it('finds a review by order id, null on miss', async () => {
    orderReview.findUnique.mockResolvedValue(null);
    expect(await repo.findReviewByOrderId('ord-1')).toBeNull();
    expect(orderReview.findUnique).toHaveBeenCalledWith({ where: { orderId: 'ord-1' } });
  });

  it('short-circuits avgRatingForOrders for an empty id list', async () => {
    expect(await repo.avgRatingForOrders([])).toEqual({ average: null, count: 0 });
    expect(orderReview.aggregate).not.toHaveBeenCalled();
  });

  it('aggregates the average rating over a set of orders', async () => {
    orderReview.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: { _all: 2 } });
    const out = await repo.avgRatingForOrders(['ord-1', 'ord-2']);
    expect(out).toEqual({ average: 4.5, count: 2 });
    expect(orderReview.aggregate).toHaveBeenCalledWith({
      where: { orderId: { in: ['ord-1', 'ord-2'] } },
      _avg: { rating: true },
      _count: { _all: true },
    });
  });

  it('builds daily and monthly sales series from raw rows', async () => {
    $queryRaw.mockResolvedValue([{ period: '2026-01-01', orderCount: BigInt(3), revenue: 300000 }]);
    const daily = await repo.salesSeries('daily', { from: new Date('2026-01-01'), to: new Date('2026-02-01') });
    expect(daily).toEqual([{ period: '2026-01-01', orderCount: 3, revenue: 300000 }]);

    $queryRaw.mockResolvedValue([{ period: '2026-01', orderCount: BigInt(3), revenue: null }]);
    const monthly = await repo.salesSeries('monthly', {});
    expect(monthly).toEqual([{ period: '2026-01', orderCount: 3, revenue: 0 }]);
  });

  it('ranks top customers by revenue', async () => {
    order.groupBy.mockResolvedValue([
      { customerId: 'cust-1', _sum: { total: dec(500000) }, _count: { _all: 4 } },
      { customerId: 'cust-2', _sum: { total: null }, _count: { _all: 0 } },
    ]);
    const out = await repo.topCustomers({}, 5);
    expect(out).toEqual([
      { customerId: 'cust-1', orderCount: 4, revenue: 500000 },
      { customerId: 'cust-2', orderCount: 0, revenue: 0 },
    ]);
  });

  it('ranks top depots by revenue', async () => {
    order.groupBy.mockResolvedValue([{ depotId: 'depot-1', _sum: { total: dec(400000) }, _count: { _all: 3 } }]);
    const out = await repo.topDepots({}, 5);
    expect(out).toEqual([{ depotId: 'depot-1', orderCount: 3, revenue: 400000 }]);
  });

  it('sums shipping billed by depot', async () => {
    order.groupBy.mockResolvedValue([{ depotId: 'depot-1', _sum: { deliveryFee: dec(15000) } }]);
    expect(await repo.shippingByDepot({})).toEqual([{ depotId: 'depot-1', shippingBilled: 15000 }]);
  });

  it('sums refunds by depot (null sum -> 0)', async () => {
    order.groupBy.mockResolvedValue([
      { depotId: 'depot-1', _sum: { refundedAmount: dec(20000) } },
      { depotId: 'depot-2', _sum: { refundedAmount: null } },
    ]);
    const out = await repo.refundsByDepot({ from: new Date('2026-01-01') });
    expect(out).toEqual([
      { depotId: 'depot-1', refunded: 20000 },
      { depotId: 'depot-2', refunded: 0 },
    ]);
  });

  it('records a refund amount on an order', async () => {
    order.update.mockResolvedValue({});
    await repo.recordRefund('ord-1', 20000);
    expect(order.update).toHaveBeenCalledWith({ where: { id: 'ord-1' }, data: { refundedAmount: 20000 } });
  });

  it('computes average rating per depot from raw rows', async () => {
    $queryRaw.mockResolvedValue([{ depotId: 'depot-1', rating: 4.2, reviewCount: BigInt(10) }]);
    const out = await repo.ratingByDepot({});
    expect(out).toEqual([{ depotId: 'depot-1', rating: 4.2, reviewCount: 10 }]);
  });

  it('builds a depot ratings detail (distribution + recent)', async () => {
    $queryRaw
      .mockResolvedValueOnce([
        { rating: 5, n: BigInt(3) },
        { rating: 4, n: BigInt(1) },
      ])
      .mockResolvedValueOnce([
        { customerName: 'Budi', stars: 5, comment: 'great', createdAt: new Date('2026-01-02') },
      ]);
    const out = await repo.depotRatings('depot-1', {});
    expect(out.count).toBe(4);
    expect(out.average).toBeCloseTo((5 * 3 + 4 * 1) / 4);
    expect(out.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 1, '5': 3 });
    expect(out.recent).toEqual([
      { customerName: 'Budi', stars: 5, comment: 'great', createdAt: new Date('2026-01-02') },
    ]);
  });

  it('returns a null average when a depot has no reviews', async () => {
    $queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const out = await repo.depotRatings('depot-1', {});
    expect(out).toEqual({
      average: null,
      count: 0,
      distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      recent: [],
    });
  });

  it('ranks revenue by product from order items', async () => {
    orderItem.groupBy.mockResolvedValue([
      { productId: 'p-1', productName: 'Galon 19L', _sum: { lineTotal: dec(300000) }, _count: { _all: 6 } },
      { productId: 'p-2', productName: 'Botol', _sum: { lineTotal: null }, _count: { _all: 0 } },
    ]);
    const out = await repo.revenueByProduct({}, 10);
    expect(out).toEqual([
      { productId: 'p-1', productName: 'Galon 19L', orderCount: 6, revenue: 300000 },
      { productId: 'p-2', productName: 'Botol', orderCount: 0, revenue: 0 },
    ]);
  });

  it('maps retention cohort raw rows', async () => {
    $queryRaw.mockResolvedValue([{ cohort: '2026-01', monthIndex: 1, customers: BigInt(4) }]);
    const out = await repo.retentionCohort({});
    expect(out).toEqual([{ cohort: '2026-01', monthIndex: 1, customers: 4 }]);
  });

  it('aggregates a customer lifetime', async () => {
    order.aggregate.mockResolvedValue({
      _sum: { total: dec(1000000) },
      _count: { _all: 12 },
      _min: { createdAt: new Date('2025-06-01') },
      _max: { createdAt: new Date('2026-01-01') },
    });
    const out = await repo.customerLifetime('cust-1');
    expect(out).toEqual({
      orderCount: 12,
      revenue: 1000000,
      firstOrderAt: new Date('2025-06-01'),
      lastOrderAt: new Date('2026-01-01'),
    });
  });

  it('reports audience reach (with and without a depot filter)', async () => {
    $queryRaw.mockResolvedValue([{ count: BigInt(42) }]);
    expect(await repo.audienceReach('depot-1')).toBe(42);
    $queryRaw.mockResolvedValue([]);
    expect(await repo.audienceReach()).toBe(0);
  });

  it('lists every order for a depot within a range', async () => {
    order.findMany.mockResolvedValue([orderRow()]);
    await repo.ordersForDepot('depot-1', { from: new Date('2026-01-01'), to: new Date('2026-02-01') });
    expect(order.findMany).toHaveBeenCalledWith({
      where: { depotId: 'depot-1', createdAt: { gte: new Date('2026-01-01'), lt: new Date('2026-02-01') } },
      include: expect.any(Object),
      orderBy: { createdAt: 'asc' },
    });
  });

  it('estimates a segment size from raw rows (default 0)', async () => {
    $queryRaw.mockResolvedValue([{ count: BigInt(7) }]);
    expect(
      await repo.segmentEstimate({
        depotId: 'depot-1',
        minOrders: 3,
        recencyCutoff: new Date('2026-01-01'),
        lapsedCutoff: new Date('2026-03-01'),
        firstOrderCutoff: new Date('2025-01-01'),
      }),
    ).toBe(7);
    $queryRaw.mockResolvedValue([]);
    expect(await repo.segmentEstimate({})).toBe(0);
  });
});
