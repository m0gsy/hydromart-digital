import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CartPrismaRepository } from '../../src/infrastructure/prisma/cart.prisma.repository';
import { SubscriptionPrismaRepository } from '../../src/infrastructure/prisma/subscription.prisma.repository';
import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { OrderStatus } from '../../src/domain/order-status';
import { CreateOrderData } from '../../src/application/ports/order.repository';
import {
  DuplicateCheckoutError,
  OrderAlreadyVoidedError,
  ReportRangeTooLargeError,
} from '../../src/domain/errors';

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
    expect(model.deleteMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', productId: 'p-1' },
    });
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
    updateMany: jest.fn(),
    groupBy: jest.fn(),
  };
  const $queryRaw = jest.fn();
  const prisma = { subscription: model, $queryRaw } as unknown as PrismaService;
  const repo = new SubscriptionPrismaRepository(prisma);
  const row = {
    id: 'sub-1',
    customerId: 'cust-1',
    productId: 'p-1',
    productName: 'Galon 19L',
    unit: 'galon',
    volumeMl: 19000,
    isGallon: true,
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
    expect(model.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'p-1' }),
    });
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
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { status: 'PAUSED' },
    });
    const due = new Date('2026-02-01');
    const next = new Date('2026-02-08');
    model.updateMany.mockResolvedValue({ count: 1 });
    // H-3: the schedule only moves from the date the sweep read it at, so one due
    // delivery advances once however many sweeps are looking at it.
    await expect(repo.advance('sub-1', due, next)).resolves.toBe(true);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: 'ACTIVE', nextDeliveryAt: due },
      data: { nextDeliveryAt: next },
    });

    model.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.advance('sub-1', due, next)).resolves.toBe(false);
  });

  it('summarizes the active network, sorted by subscriber count desc', async () => {
    model.groupBy.mockResolvedValue([
      { productName: 'Galon 19L', frequency: 'WEEKLY', _count: { _all: 2 } },
      { productName: 'Botol 600ml', frequency: 'MONTHLY', _count: { _all: 5 } },
    ]);
    $queryRaw.mockResolvedValue([{ count: BigInt(2) }]);
    const out = await repo.networkSummary();
    expect(out.activeSubscriptions).toBe(7);
    expect(out.activeSubscribers).toBe(2);
    expect(out.plans[0].subscribers).toBe(5); // sorted desc
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['productName', 'frequency'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
    });
    // COUNT(DISTINCT) in Postgres — a page bound must not be able to lower the count.
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('reports zero subscribers when the count query comes back empty', async () => {
    model.groupBy.mockResolvedValue([]);
    $queryRaw.mockResolvedValue([]);
    expect((await repo.networkSummary()).activeSubscribers).toBe(0);
  });
});

describe('OrderPrismaRepository', () => {
  const order = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  };
  const orderReview = { create: jest.fn(), findUnique: jest.fn(), aggregate: jest.fn() };
  const orderItem = { groupBy: jest.fn() };
  const orderStatusHistory = { create: jest.fn() };
  const $queryRaw = jest.fn();
  // H-10: the order write and its outbox rows go in one transaction. Promise.all so a
  // rejected op (the P2002 / P2025 cases below) still reaches the repository's catch.
  const outboxMessage = { create: jest.fn() };
  const $transaction = jest.fn((ops: unknown[]) => Promise.all(ops));
  const prisma = {
    order,
    orderReview,
    orderItem,
    orderStatusHistory,
    outboxMessage,
    $transaction,
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
    driverPhone: null,
    estimatedArrivalAt: null,
    items: [
      {
        id: 'it-1',
        productId: 'p-1',
        productName: 'Galon 19L',
        sku: 'G19',
        unit: 'galon',
        volumeMl: 19000,
        isGallon: true,
        unitPrice: dec(20000),
        quantity: 5,
        lineTotal: dec(100000),
      },
    ],
    history: [
      { status: 'CREATED', changedBy: null, note: null, createdAt: new Date('2026-01-01') },
    ],
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
        volumeMl: 19000,
        isGallon: true,
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

  // B-13. The unique index is the guard; this is the translation that lets the service
  // recognise it and answer with the order the winning attempt placed.
  it('translates the idempotency-key unique violation into DuplicateCheckoutError', async () => {
    order.create.mockRejectedValue(
      Object.assign(new Error('unique'), {
        code: 'P2002',
        meta: { target: ['customerId', 'idempotencyKey'] },
      }),
    );
    await expect(repo.create(createData)).rejects.toBeInstanceOf(DuplicateCheckoutError);
  });

  it('rethrows a unique violation on any other column', async () => {
    // An orderNumber collision (H-12) is ours, not the caller's — swallowing it as a
    // duplicate checkout would hand the caller somebody else's order.
    const clash = Object.assign(new Error('unique'), {
      code: 'P2002',
      meta: { target: 'orders_orderNumber_key' },
    });
    order.create.mockRejectedValue(clash);
    await expect(repo.create(createData)).rejects.toBe(clash);
  });

  it('rethrows a non-unique database failure', async () => {
    const boom = Object.assign(new Error('down'), { code: 'P1001' });
    order.create.mockRejectedValue(boom);
    await expect(repo.create(createData)).rejects.toBe(boom);
  });

  it('rethrows a rejection that carries no error object at all', async () => {
    order.create.mockRejectedValue('connection reset');
    await expect(repo.create(createData)).rejects.toBe('connection reset');
  });

  it('rethrows a P2002 that names no column', async () => {
    const vague = Object.assign(new Error('unique'), { code: 'P2002' });
    order.create.mockRejectedValue(vague);
    await expect(repo.create(createData)).rejects.toBe(vague);
  });

  // H-10: the effects a transition earns are written in the SAME transaction as it, so an
  // order cannot end up COMPLETED with its stock consume and owner credit owed to nobody.
  it('writes the outbox rows alongside the status change, in one transaction', async () => {
    order.update.mockResolvedValue({ ...orderRow(), status: 'COMPLETED' });
    await repo.applyStatus(
      'ord-1',
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
      'staff',
      null,
      undefined,
      undefined,
      undefined,
      [
        { topic: 'INVENTORY_CONSUME', orderId: 'ord-1' },
        { topic: 'FRANCHISE_REVENUE', orderId: 'ord-1' },
      ],
    );
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(outboxMessage.create).toHaveBeenCalledTimes(2);
    expect(outboxMessage.create).toHaveBeenCalledWith({
      data: { topic: 'INVENTORY_CONSUME', orderId: 'ord-1' },
    });
  });

  it('writes the outbox rows alongside a walk-in, which is born COMPLETED', async () => {
    order.create.mockResolvedValue(orderRow());
    await repo.create({
      ...createData,
      status: OrderStatus.COMPLETED,
      isWalkIn: true,
      outbox: [{ topic: 'INVENTORY_CONSUME', orderId: 'ord-1' }],
    });
    expect(outboxMessage.create).toHaveBeenCalledWith({
      data: { topic: 'INVENTORY_CONSUME', orderId: 'ord-1' },
    });
  });

  it('finds the order a previous attempt placed under an idempotency key', async () => {
    order.findUnique.mockResolvedValue(orderRow());
    const found = await repo.findByIdempotencyKey('cust-1', 'key-1');
    expect(found?.id).toBe('ord-1');
    expect(order.findUnique).toHaveBeenCalledWith({
      where: { customerId_idempotencyKey: { customerId: 'cust-1', idempotencyKey: 'key-1' } },
      include: expect.any(Object),
    });
  });

  it('returns null when no attempt has used that key', async () => {
    order.findUnique.mockResolvedValue(null);
    await expect(repo.findByIdempotencyKey('cust-1', 'key-1')).resolves.toBeNull();
  });

  it('finds an order by id, mapping reviewed=true when a review row exists', async () => {
    order.findUnique.mockResolvedValue({ ...orderRow(), review: { id: 'rev-1' } });
    const out = await repo.findById('ord-1');
    expect(out?.reviewed).toBe(true);
    expect(order.findUnique).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      include: expect.any(Object),
    });
  });

  it('assigns a depot to an order that had none', async () => {
    order.update.mockResolvedValue({ ...orderRow(), depotId: 'depot-a' });
    const out = await repo.assignDepot('ord-1', 'depot-a');
    expect(out.depotId).toBe('depot-a');
    expect(order.update).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { depotId: 'depot-a' },
      include: expect.any(Object),
    });
  });

  it('filters the unrouted tray on a null depot, ignoring any depot set', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await repo.search({ unrouted: true, depotIds: ['depot-a'], page: 1, limit: 10 });
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { depotId: null } }),
    );
  });

  /**
   * C6: the till lists its OWN sales, which is what makes the void endpoint reachable after
   * a refresh — before this the Batalkan button hung off React state, and a reload left the
   * endpoint reachable by no UI at all.
   *
   * Opt-in: absent means "either", so no existing list changes shape. That is the half
   * worth pinning, because a filter that leaked into every other query would quietly hide
   * delivery orders from the staff queue.
   */
  it('filters counter sales only when asked, and leaves every other list alone', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);

    await repo.search({ isWalkIn: true, depotIds: ['depot-a'], page: 1, limit: 10 });
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isWalkIn: true }) }),
    );

    order.findMany.mockClear();
    await repo.search({ depotIds: ['depot-a'], page: 1, limit: 10 });
    const [call] = order.findMany.mock.calls;
    expect(Object.keys((call![0] as { where: Record<string, unknown> }).where)).not.toContain('isWalkIn');
  });

  it('can ask for delivery orders only', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await repo.search({ isWalkIn: false, page: 1, limit: 10 });
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isWalkIn: false }) }),
    );
  });

  it('batch-reads order totals in one selected findMany query', async () => {
    order.findMany.mockResolvedValue([
      { id: 'ord-1', orderNumber: 'HM-1', total: dec(103_000) },
      { id: 'ord-2', orderNumber: 'HM-2', total: dec(47_500) },
    ]);

    const result = await (
      repo as unknown as {
        findOrderValues(
          ids: string[],
        ): Promise<{ orderId: string; orderNumber: string; totalIdr: number }[]>;
      }
    ).findOrderValues(['ord-1', 'ord-2', 'missing']);

    expect(result).toEqual([
      { orderId: 'ord-1', orderNumber: 'HM-1', totalIdr: 103_000 },
      { orderId: 'ord-2', orderNumber: 'HM-2', totalIdr: 47_500 },
    ]);
    expect(order.findMany).toHaveBeenCalledTimes(1);
    expect(order.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['ord-1', 'ord-2', 'missing'] } },
      select: { id: true, orderNumber: true, total: true },
    });
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
      depotIds: ['depot-1'],
      page: 2,
      limit: 10,
    });
    expect(out.total).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(order.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', status: OrderStatus.CREATED, depotId: { in: ['depot-1'] } },
      include: expect.any(Object),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(order.count).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', status: OrderStatus.CREATED, depotId: { in: ['depot-1'] } },
    });
  });

  // Audit F-12: HQ global search used to pull a page of orders and match the number in
  // the browser, so anything older than the last twenty was unfindable.
  it('matches an order-number term in the query, trimmed and case-insensitive', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await repo.search({ orderNumber: ' hm-2026 ', page: 1, limit: 10 });
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderNumber: { contains: 'hm-2026', mode: 'insensitive' } },
      }),
    );
  });

  it('omits the order-number predicate when the term is blank', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    await repo.search({ orderNumber: '  ', page: 1, limit: 10 });
    expect(order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('searches with an empty where when no filters are given', async () => {
    order.findMany.mockResolvedValue([]);
    order.count.mockResolvedValue(0);
    const out = await repo.search({ page: 1, limit: 20 });
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, skip: 0, take: 20 }),
    );
    // A short page is the end of the list, so there is nothing to page on to.
    expect(out.nextCursor).toBeNull();
  });

  it('seeks past a cursor instead of skipping an offset, and hands the next one back', async () => {
    const rows = [
      { ...orderRow(), id: 'o-1' },
      { ...orderRow(), id: 'o-2' },
    ];
    order.findMany.mockResolvedValue(rows);
    order.count.mockResolvedValue(50);

    const out = await repo.search({ page: 9, limit: 2, cursor: 'o-0' });

    // `page` is ignored once a cursor is given — honouring both would re-read or skip rows.
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'o-0' }, skip: 1, take: 2 }),
    );
    expect(out.nextCursor).toBe('o-2');
  });

  // `subscriptionId: null` was added here in D1, and this assertion was inverted with it:
  // it previously pinned a `where` that made every scheduled delivery a sweep candidate.
  // The exclusion has to be in the query, so the query is where it is asserted.
  it('finds stale orders in the given statuses before a cutoff, oldest first, capped, and never a subscription delivery', async () => {
    order.findMany.mockResolvedValue([orderRow()]);
    const before = new Date('2026-01-05');
    await repo.findStaleIn([OrderStatus.CREATED, OrderStatus.CONFIRMED], before);
    expect(order.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: [OrderStatus.CREATED, OrderStatus.CONFIRMED] },
        createdAt: { lt: before },
        subscriptionId: null,
      },
      include: expect.any(Object),
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  });

  it('drops the subscription exclusion when the D1 kill switch is off', async () => {
    order.findMany.mockResolvedValue([]);
    const before = new Date('2026-01-05');
    await repo.findStaleIn([OrderStatus.CREATED], before, undefined, false);
    expect(order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: [OrderStatus.CREATED] }, createdAt: { lt: before } } }),
    );
  });

  it('lets the caller shrink the stale-sweep batch', async () => {
    order.findMany.mockResolvedValue([]);
    await repo.findStaleIn([OrderStatus.CREATED], new Date('2026-01-05'), 25);
    expect(order.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
  });

  it('short-circuits an empty status list without querying', async () => {
    order.findMany.mockClear();
    expect(await repo.findStaleIn([], new Date())).toEqual([]);
    expect(order.findMany).not.toHaveBeenCalled();
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

  // A fact about an order that is not a transition — "priced from the catalog because the
  // depot was unreachable". Reusing applyStatus would repeat the status on the timeline,
  // which staff read as something having happened twice.
  it('appendNote writes a history row without touching the order', async () => {
    await repo.appendNote('ord-1', OrderStatus.CONFIRMED, 'order-service', 'harga katalog');

    expect(orderStatusHistory.create).toHaveBeenCalledWith({
      data: {
        orderId: 'ord-1',
        status: OrderStatus.CONFIRMED,
        changedBy: 'order-service',
        note: 'harga katalog',
      },
    });
    expect(order.update).not.toHaveBeenCalled();
  });

  it('applies a status transition and appends history (no driver name)', async () => {
    order.update.mockResolvedValue({ ...orderRow(), status: 'CONFIRMED' });
    const out = await repo.applyStatus(
      'ord-1',
      OrderStatus.CREATED,
      OrderStatus.CONFIRMED,
      'admin-1',
      'ok',
    );
    expect(out.status).toBe(OrderStatus.CONFIRMED);
    // H-4: the status the caller read is part of the WHERE, so a transition computed
    // against a stale row matches nothing instead of overwriting the newer one.
    expect(order.update).toHaveBeenCalledWith({
      where: { id: 'ord-1', status: OrderStatus.CREATED },
      data: {
        status: OrderStatus.CONFIRMED,
        history: { create: { status: OrderStatus.CONFIRMED, changedBy: 'admin-1', note: 'ok' } },
      },
      include: expect.any(Object),
    });
  });

  it('sets the driver name when provided', async () => {
    order.update.mockResolvedValue({
      ...orderRow(),
      driverName: 'Joko',
      status: 'DRIVER_ASSIGNED',
    });
    await repo.applyStatus(
      'ord-1',
      OrderStatus.CONFIRMED,
      OrderStatus.DRIVER_ASSIGNED,
      null,
      null,
      'Joko',
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ driverName: 'Joko' }) }),
    );
  });

  // Audit S-23 and its Q-17 baseline row. The timeline is what ONE order's card renders; a
  // monthly depot report reads every order that depot took and renders none of them, so it
  // was hauling a handful of history rows per order for nothing. Same for the stale sweep,
  // which cancels and releases stock.
  it('does not include history on the report read', async () => {
    order.findMany.mockResolvedValue([]);
    await repo.ordersForDepot('depot-1', {});
    await repo.findStaleIn([OrderStatus.CREATED], new Date('2026-01-01'), 50);
    for (const call of order.findMany.mock.calls) {
      expect(call[0].include).not.toHaveProperty('history');
      expect(call[0].include).toHaveProperty('items');
    }
    expect(order.findMany).toHaveBeenCalledTimes(2);
  });

  // Audit S-12 and its Q-17 baseline row: the HAVING and the LIMIT belong in the statement.
  // This used to group the WHOLE order table, ship every customer who has ever ordered back
  // to Node, and throw all but `limit` of them away here.
  it('filters the reminder window in SQL', async () => {
    $queryRaw
      .mockResolvedValueOnce([{ customerId: 'cust-old' }])
      .mockResolvedValueOnce([{ customerId: 'cust-old', phone: '+62800', recipientName: 'Budi' }]);
    const cutoff = new Date('2026-01-01');
    const out = await repo.findReorderReminderTargets(cutoff, 10);
    expect(out).toEqual([{ customerId: 'cust-old', phone: '+62800', recipientName: 'Budi' }]);
    // Two statements: who is due, then their contact snapshot. Never a groupBy in Node.
    expect($queryRaw).toHaveBeenCalledTimes(2);
    expect(order.groupBy).not.toHaveBeenCalled();
    expect(order.findMany).not.toHaveBeenCalled();
  });

  it('returns [] and skips the snapshot query when nobody is due', async () => {
    $queryRaw.mockResolvedValueOnce([]);
    expect(await repo.findReorderReminderTargets(new Date('2026-01-01'), 10)).toEqual([]);
    expect($queryRaw).toHaveBeenCalledTimes(1);
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
    const daily = await repo.salesSeries('daily', {
      from: new Date('2026-01-01'),
      to: new Date('2026-02-01'),
    }, 'Asia/Jakarta');
    expect(daily).toEqual([{ period: '2026-01-01', orderCount: 3, revenue: 300000 }]);

    $queryRaw.mockResolvedValue([{ period: '2026-01', orderCount: BigInt(3), revenue: null }]);
    const monthly = await repo.salesSeries('monthly', {}, 'Asia/Jakarta');
    expect(monthly).toEqual([{ period: '2026-01', orderCount: 3, revenue: 0 }]);
  });

  // C2. The columns are naive timestamps holding UTC, so `date_trunc('day', "createdAt")`
  // cuts the day at 07:00 WIB: every order between midnight and 7am was counted on the
  // previous day, in the report the depot is judged on. Two hops — label it UTC, then read
  // it in the business zone — is the same shape depotDailyGallons already uses.
  const twoHop = (sql: { sql: string }) => sql.sql.replace(/\s+/g, ' ');
  it('cuts the sales series on the LOCAL day, not on UTC', async () => {
    $queryRaw.mockResolvedValue([]);
    await repo.salesSeries('daily', {}, 'Asia/Jakarta');
    const q = $queryRaw.mock.calls.at(-1)![0] as { sql: string; values: unknown[] };
    expect(twoHop(q)).toContain(`AT TIME ZONE 'UTC' AT TIME ZONE`);
    expect(q.values).toContain('Asia/Jakarta');
  });

  it('cuts retention cohorts on the LOCAL month, not on UTC', async () => {
    $queryRaw.mockResolvedValue([]);
    await repo.retentionCohort({}, 'Asia/Jakarta');
    const q = $queryRaw.mock.calls.at(-1)![0] as { sql: string; values: unknown[] };
    // Both the cohort month and the activity month, or a customer's first order lands in
    // one month and their first activity in another.
    expect(twoHop(q).match(/AT TIME ZONE 'UTC' AT TIME ZONE/g)?.length).toBe(2);
    expect(q.values).toContain('Asia/Jakarta');
  });

  // Depot SOP §1. The bonus is paid per attended day, and `Attendance.workDate` is a WIB
  // date — so the bucket must be cut in WIB too. `date_trunc('day', "createdAt")`, which
  // the revenue series above uses, cuts at 07:00 local and would pay the wrong day.
  it('buckets depot gallons by the LOCAL day, not by UTC', async () => {
    $queryRaw.mockResolvedValue([
      { day: '2026-07-01', gallons: BigInt(130) },
      { day: '2026-07-02', gallons: null },
    ]);
    const out = await repo.depotDailyGallons(
      'depot-1',
      new Date('2026-06-30T17:00:00.000Z'),
      new Date('2026-07-31T17:00:00.000Z'),
      'Asia/Jakarta',
    );
    expect(out).toEqual([
      { day: '2026-07-01', gallons: 130 },
      { day: '2026-07-02', gallons: 0 },
    ]);
    const sql = ($queryRaw.mock.calls.at(-1)?.[0] as { strings: string[] }).strings.join('');
    expect(sql).toContain(`AT TIME ZONE 'UTC' AT TIME ZONE`);
    expect(sql).toContain('"isGallon" = true');
  });

  // H-12: the order number's counter comes from a Postgres sequence now. `?? 0` is the
  // no-row case — it cannot happen against a real `nextval`, but a 0 suffix is a visible
  // wrong answer rather than a crash, so it is pinned rather than left to chance.
  it('reads the order-number counter from the sequence', async () => {
    $queryRaw.mockResolvedValue([{ v: BigInt(1_000_042) }]);
    expect(await repo.nextOrderSequence()).toBe(1_000_042);
    const sql = ($queryRaw.mock.calls.at(-1)?.[0] as string[]).join('');
    expect(sql).toContain("nextval('order_number_seq')");

    $queryRaw.mockResolvedValue([]);
    expect(await repo.nextOrderSequence()).toBe(0);
  });

  // H-14: these four raw reports excluded only CANCELLED while every Prisma-built report
  // beside them excluded VOIDED too — so a voided counter sale still counted as revenue
  // and still put its buyer in a retention cohort. The status list is bound as a
  // parameter, so asserting on the call's values is what proves the predicate.
  it.each([
    ['salesSeries', (r: typeof repo) => r.salesSeries('daily', {}, 'Asia/Jakarta')],
    ['retentionCohort', (r: typeof repo) => r.retentionCohort({}, 'Asia/Jakarta')],
    ['audienceReach', (r: typeof repo) => r.audienceReach()],
    ['segmentEstimate', (r: typeof repo) => r.segmentEstimate({})],
    ['segmentCustomerIds', (r: typeof repo) => r.segmentCustomerIds({}, 10)],
  ])('excludes both CANCELLED and VOIDED from %s', async (_name, run) => {
    $queryRaw.mockResolvedValue([]);
    await run(repo);
    const values = ($queryRaw.mock.calls.at(-1)?.[0] as { values: unknown[] }).values;
    expect(values).toEqual(expect.arrayContaining(['CANCELLED', 'VOIDED']));
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
    order.groupBy.mockResolvedValue([
      { depotId: 'depot-1', _sum: { total: dec(400000) }, _count: { _all: 3 } },
    ]);
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

  it('depotCustomerAggregates: empty groupBy short-circuits (no contact fetch)', async () => {
    order.groupBy.mockResolvedValue([]);
    expect(await repo.depotCustomerAggregates('depot-1')).toEqual([]);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('depotCustomerAggregates: maps aggregates + latest contact, null sum/contact defaults', async () => {
    order.groupBy.mockResolvedValue([
      {
        customerId: 'c1',
        _count: { _all: 3 },
        _sum: { total: dec(90000) },
        _min: { createdAt: new Date('2026-01-01') },
        _max: { createdAt: new Date('2026-06-01') },
      },
      {
        customerId: 'c2',
        _count: { _all: 1 },
        _sum: { total: null },
        _min: { createdAt: new Date('2026-02-01') },
        _max: { createdAt: new Date('2026-02-01') },
      },
    ]);
    // c1 has a latest-order contact snapshot; c2 has none → name/phone default to null.
    $queryRaw.mockResolvedValue([{ customerId: 'c1', phone: '0812', recipientName: 'Andi' }]);

    const out = await repo.depotCustomerAggregates('depot-1');
    expect(out).toEqual([
      {
        customerId: 'c1',
        name: 'Andi',
        phone: '0812',
        orderCount: 3,
        totalSpent: 90000,
        firstOrderAt: new Date('2026-01-01'),
        lastOrderAt: new Date('2026-06-01'),
      },
      {
        customerId: 'c2',
        name: null,
        phone: null,
        orderCount: 1,
        totalSpent: 0,
        firstOrderAt: new Date('2026-02-01'),
        lastOrderAt: new Date('2026-02-01'),
      },
    ]);
    // The contact snapshot is one DISTINCT ON query, scoped to this depot.
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(order.findMany).not.toHaveBeenCalled();
  });

  describe('voidWalkIn', () => {
    const at = new Date('2026-08-03T09:00:00Z');

    // The guard lives in the WHERE, not only in the service: two cashiers hitting void on
    // the same sale would otherwise both restock and both refund it.
    it('flips only a COMPLETED counter sale, and appends the reason to history', async () => {
      order.updateMany.mockResolvedValue({ count: 1 });
      order.findUnique.mockResolvedValue(orderRow());

      await repo.voidWalkIn('ord-1', 'Salah ukuran', 'cashier-1', at);

      expect(order.updateMany).toHaveBeenCalledWith({
        where: { id: 'ord-1', status: 'COMPLETED', isWalkIn: true },
        data: { status: 'VOIDED', voidedAt: at, voidReason: 'Salah ukuran' },
      });
      expect(orderStatusHistory.create).toHaveBeenCalledWith({
        data: { orderId: 'ord-1', status: 'VOIDED', changedBy: 'cashier-1', note: 'Salah ukuran' },
      });
    });

    it('rejects the second void and writes no history for it', async () => {
      order.updateMany.mockResolvedValue({ count: 0 });

      await expect(repo.voidWalkIn('ord-1', 'Lagi', 'cashier-2', at)).rejects.toBeInstanceOf(
        OrderAlreadyVoidedError,
      );
      expect(orderStatusHistory.create).not.toHaveBeenCalled();
    });
  });

  it('records a refund amount on an order', async () => {
    order.update.mockResolvedValue({});
    await repo.recordRefund('ord-1', 20000);
    expect(order.update).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { refundedAmount: 20000 },
    });
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
      {
        productId: 'p-1',
        productName: 'Galon 19L',
        _sum: { lineTotal: dec(300000) },
        _count: { _all: 6 },
      },
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
    const out = await repo.retentionCohort({}, 'Asia/Jakarta');
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

  it('lists every order for a depot within a range, one keyset page at a time', async () => {
    order.findMany.mockResolvedValue([orderRow()]);
    await repo.ordersForDepot('depot-1', {
      from: new Date('2026-01-01'),
      to: new Date('2026-02-01'),
    });
    expect(order.findMany).toHaveBeenCalledWith({
      where: {
        depotId: 'depot-1',
        createdAt: { gte: new Date('2026-01-01'), lt: new Date('2026-02-01') },
      },
      include: expect.any(Object),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  });

  it('walks past the first page with a cursor and stops on a short page', async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ ...orderRow(), id: `o-${i}` }));
    order.findMany.mockResolvedValueOnce(full).mockResolvedValueOnce([orderRow()]);
    const out = await repo.ordersForDepot('depot-1', {});
    expect(out).toHaveLength(501);
    expect(order.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: 'o-499' }, skip: 1 }),
    );
  });

  it('refuses a window bigger than the report ceiling instead of truncating it', async () => {
    // Every page comes back full, so the walk never terminates on its own — exactly the
    // shape of "a report over a range nobody should ask for in one response".
    const full = Array.from({ length: 500 }, (_, i) => ({ ...orderRow(), id: `o-${i}` }));
    order.findMany.mockResolvedValue(full);
    await expect(repo.ordersForDepot('depot-1', {})).rejects.toThrow(ReportRangeTooLargeError);
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

  /*
   * The id list and the count must be the SAME segment. They are two queries because a
   * count should not materialise ids, so the predicates are built once and shared — this
   * pins that the conditions really reach the id query, and that the LIMIT is bound
   * (an unbounded id list is a whole audience in one response).
   */
  it('lists a segment’s customer ids under the same conditions, bounded by the limit', async () => {
    $queryRaw.mockResolvedValue([{ customerId: 'cust-1' }, { customerId: 'cust-2' }]);
    const out = await repo.segmentCustomerIds(
      { depotId: 'depot-1', minOrders: 3, lapsedCutoff: new Date('2026-03-01') },
      2,
    );
    expect(out).toEqual(['cust-1', 'cust-2']);
    const values = ($queryRaw.mock.calls.at(-1)?.[0] as { values: unknown[] }).values;
    expect(values).toEqual(expect.arrayContaining(['depot-1', 3, new Date('2026-03-01'), 2]));
  });

  it('returns an empty list when nobody matches', async () => {
    $queryRaw.mockResolvedValue([]);
    expect(await repo.segmentCustomerIds({}, 10)).toEqual([]);
  });
});
