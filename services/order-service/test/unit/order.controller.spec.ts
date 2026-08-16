import { ForbiddenException } from '@nestjs/common';

import {
  CAPABILITY_KEY,
  IS_PUBLIC_KEY,
  InternalAuthGuard,
  ROLES_KEY,
  Role,
} from '@hydromart/platform';

import { OrderController } from '../../src/modules/order.controller';
import { OrderService } from '../../src/application/services/order.service';
import { OutboxService } from '../../src/application/services/outbox.service';

type Mocked = { [K in keyof OrderService]: jest.Mock };

// SUPER_ADMIN so the real assertDepotAccess / depotScopeIds guards are no-ops and we can
// exercise the controller's own mapping logic (the depot-lock branches live in @hydromart/platform).
const admin = { sub: 'admin-1', role: 'SUPER_ADMIN' } as never;
const customer = { sub: 'cust-1', role: 'CUSTOMER' } as never;

function makeService(): Mocked {
  return {
    checkout: jest.fn().mockResolvedValue({ id: 'o1' }),
    walkInSale: jest.fn().mockResolvedValue({ id: 'w1', isWalkIn: true }),
    voidCounterSale: jest.fn().mockResolvedValue({ id: 'w1', status: 'VOIDED' }),
    expireAbandoned: jest.fn().mockResolvedValue({ cancelled: 3 }),
    listForCustomer: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listAll: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getAny: jest.fn().mockResolvedValue({ id: 'o1', depotId: 'd1', total: 42000 }),
    assignDepot: jest.fn().mockResolvedValue({ id: 'order-1', depotId: 'depot-a' }),
    listCompletedPage: jest.fn(),
    sumDepotSales: jest.fn().mockResolvedValue(150000),
    depotCustomerAggregates: jest.fn(),
    customerOrdersAtDepot: jest.fn().mockResolvedValue([]),
    findOrderValues: jest.fn().mockResolvedValue([{ orderId: 'o1', total: 42000 }]),
    remindStaleCustomers: jest.fn().mockResolvedValue({ reminded: 4 }),
    getForCustomer: jest.fn().mockResolvedValue({ id: 'o1', history: ['h1', 'h2'] }),
    cancel: jest.fn().mockResolvedValue({ id: 'o1', status: 'CANCELLED' }),
    repeat: jest.fn().mockResolvedValue({ items: ['x'] }),
    getReview: jest.fn().mockResolvedValue(null),
    reviewOrder: jest.fn().mockResolvedValue({ id: 'r1' }),
    confirmPaid: jest.fn().mockResolvedValue({ id: 'o1', status: 'CONFIRMED' }),
    recordRefund: jest.fn().mockResolvedValue(undefined),
    ratingSummary: jest.fn().mockResolvedValue({ average: 4.5, count: 2 }),
    updateStatus: jest.fn().mockResolvedValue({ id: 'o1', status: 'DELIVERED' }),
  } as unknown as Mocked;
}

describe('OrderController', () => {
  let service: Mocked;
  let controller: OrderController;
  let outbox: { processDue: jest.Mock; pending: jest.Mock };

  beforeEach(() => {
    service = makeService();
    outbox = {
      processDue: jest.fn().mockResolvedValue({ claimed: 2, delivered: 2, failed: 0, dead: 0 }),
      pending: jest.fn().mockResolvedValue({ PENDING: 1, DONE: 9, DEAD: 0 }),
    };
    controller = new OrderController(
      service as unknown as OrderService,
      outbox as unknown as OutboxService,
    );
  });

  const address = {
    recipientName: 'Budi',
    phone: '0811',
    addressLine: 'Jl 1',
    city: 'Bandung',
    province: 'Jabar',
  };

  it('checkout: maps address nullish fields, voucher and window, forwards the token', async () => {
    const dto = { deliveryAddress: address } as never;
    await expect(controller.checkout(customer, dto, 'Bearer t')).resolves.toEqual({ id: 'o1' });
    const [customerId, payload, authorization] = service.checkout.mock.calls[0];
    expect(customerId).toBe('cust-1');
    expect(authorization).toBe('Bearer t');
    expect(payload.deliveryAddress).toMatchObject({
      postalCode: null,
      latitude: null,
      longitude: null,
      notes: null,
    });
    expect(payload.voucherCode).toBeNull();
    expect(payload.deliveryWindow).toBeNull();
    expect(payload.idempotencyKey).toBeNull();
  });

  // B-13: the key only ever arrives as a header, so this hand-off is the whole of the
  // wiring — if it is dropped here, every guard behind it is dead code.
  it('checkout: forwards the Idempotency-Key header to the service', async () => {
    const dto = { deliveryAddress: address } as never;
    await controller.checkout(customer, dto, 'Bearer t', 'attempt-1');
    expect(service.checkout.mock.calls[0][1].idempotencyKey).toBe('attempt-1');
  });

  it('walk-in: forwards the Idempotency-Key header to the service', async () => {
    const staff = { sub: 'op-1', role: 'KEPALA_DEPOT', depotId: 'd1' } as never;
    const dto = { depotId: 'd1', lines: [{ productId: 'p1', quantity: 2 }] } as never;
    await controller.walkIn(staff, dto, 'Bearer t', 'till-1');
    expect(service.walkInSale.mock.calls[0][1].idempotencyKey).toBe('till-1');
  });

  it('walk-in: forwards the lines and nulls the optional buyer fields', async () => {
    const staff = { sub: 'op-1', role: 'KEPALA_DEPOT', depotId: 'd1' } as never;
    const dto = { depotId: 'd1', lines: [{ productId: 'p1', quantity: 2 }] } as never;
    await expect(controller.walkIn(staff, dto, 'Bearer t')).resolves.toEqual({
      id: 'w1',
      isWalkIn: true,
    });
    const [user, payload, authorization] = service.walkInSale.mock.calls[0];
    expect(user).toBe(staff);
    expect(authorization).toBe('Bearer t');
    expect(payload).toEqual({
      depotId: 'd1',
      lines: [{ productId: 'p1', quantity: 2 }],
      customerId: null,
      customerName: null,
      customerPhone: null,
      voucherCode: null,
      idempotencyKey: null,
    });
  });

  // `now` comes from the controller, not the client: a cashier who could name the moment
  // could reopen yesterday's drawer.
  it('walk-in void: stamps the server clock and forwards the reason + token', async () => {
    const staff = { sub: 'op-1', role: 'KEPALA_DEPOT', depotId: 'd1' } as never;
    const before = Date.now();
    await controller.voidWalkIn(staff, 'ord-1', { reason: 'Salah ukuran' } as never, 'Bearer t');
    const [user, id, reason, now, authorization] = service.voidCounterSale.mock.calls[0];
    expect([user, id, reason, authorization]).toEqual([staff, 'ord-1', 'Salah ukuran', 'Bearer t']);
    expect((now as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('walk-in: passes an identified buyer through', async () => {
    const staff = { sub: 'op-1', role: 'KEPALA_DEPOT', depotId: 'd1' } as never;
    const dto = {
      depotId: 'd1',
      lines: [{ productId: 'p1', quantity: 1 }],
      customerId: 'c9',
      customerName: 'Budi',
      customerPhone: '0812',
    } as never;
    await controller.walkIn(staff, dto, undefined);
    expect(service.walkInSale.mock.calls.at(-1)?.[1]).toMatchObject({
      customerId: 'c9',
      customerName: 'Budi',
      customerPhone: '0812',
    });
  });

  it('checkout: preserves supplied voucher, window and optional address fields', async () => {
    const dto = {
      deliveryAddress: {
        ...address,
        postalCode: '40111',
        latitude: -6.9,
        longitude: 107.6,
        notes: 'n',
      },
      voucherCode: 'HEMAT',
      deliveryWindow: 'MORNING',
    } as never;
    await controller.checkout(customer, dto);
    const [, payload, authorization] = service.checkout.mock.calls[0];
    expect(authorization).toBeUndefined();
    expect(payload.voucherCode).toBe('HEMAT');
    expect(payload.deliveryWindow).toBe('MORNING');
    expect(payload.deliveryAddress).toMatchObject({ postalCode: '40111', notes: 'n' });
  });

  it('expireAbandoned: passes a positive minutes override, else undefined', async () => {
    await expect(controller.expireAbandoned(admin, 'Bearer t', '30')).resolves.toEqual({
      cancelled: 3,
    });
    expect(service.expireAbandoned).toHaveBeenCalledWith('admin-1', 'Bearer t', 30);
    await controller.expireAbandoned(admin, undefined, '0');
    expect(service.expireAbandoned).toHaveBeenLastCalledWith('admin-1', undefined, undefined);
    await controller.expireAbandoned(admin);
    expect(service.expireAbandoned).toHaveBeenLastCalledWith('admin-1', undefined, undefined);
  });

  it('list: scopes to the current customer', async () => {
    await controller.list(customer, { limit: 20 } as never);
    expect(service.listForCustomer).toHaveBeenCalledWith('cust-1', { limit: 20 });
  });

  it('listManaged: applies the depot scope filter (undefined for SUPER_ADMIN)', async () => {
    await controller.listManaged(admin, { depotId: 'd9', limit: 10 } as never);
    expect(service.listAll).toHaveBeenCalledWith({ depotIds: ['d9'], limit: 10 });
  });

  // UAT-M28-14: a courier token used to list every depot's orders — customer names,
  // addresses and phone numbers across the whole network — from a device in the field.
  it('listManaged: pins a courier to their own depot, ignoring any ?depotId', async () => {
    const driver = { sub: 'drv-1', role: Role.STAFF_DEPOT, depotId: 'depot-a' } as never;
    await controller.listManaged(driver, { depotId: 'depot-b', limit: 10 } as never);
    expect(service.listAll).toHaveBeenCalledWith({ depotIds: ['depot-a'], limit: 10 });
  });

  it('listManaged: refuses a courier whose token carries no depot', async () => {
    const orphan = { sub: 'drv-2', role: Role.STAFF_DEPOT, depotId: null } as never;
    await expect(controller.listManaged(orphan, { limit: 10 } as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.listAll).not.toHaveBeenCalled();
  });

  it('listManaged: lets HQ read the unrouted tray but refuses a depot-scoped caller', async () => {
    await controller.listManaged(admin, { unrouted: true, limit: 10 } as never);
    expect(service.listAll).toHaveBeenCalledWith({ unrouted: true, limit: 10, depotIds: undefined });

    const manager = { sub: 'mgr-1', role: Role.MANAGER, depotIds: ['depot-a'] } as never;
    await expect(
      controller.listManaged(manager, { unrouted: true, limit: 10 } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('assignDepot: hands the order and depot to the service', async () => {
    await controller.assignDepot('order-1', { depotId: 'depot-a' });
    expect(service.assignDepot).toHaveBeenCalledWith('order-1', 'depot-a');
  });

  it('getManaged: loads the order then passes the depot access check', async () => {
    await expect(controller.getManaged(admin, 'o1')).resolves.toMatchObject({ id: 'o1' });
    expect(service.getAny).toHaveBeenCalledWith('o1');
  });

  it('internalCompleted: maps orders, rounds totals, defaults cursor/limit', async () => {
    service.listCompletedPage.mockResolvedValue({
      orders: [
        {
          id: 'o1',
          customerId: 'c1',
          depotId: 'd1',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          total: 42000.7,
          items: [
            { productId: 'p1', productName: 'Galon', sku: 'G19', unit: 'Galon', quantity: 2 },
          ],
        },
      ],
      nextCursor: 'cur2',
    });
    const out = await controller.internalCompleted();
    expect(service.listCompletedPage).toHaveBeenCalledWith(null, undefined);
    expect(out.nextCursor).toBe('cur2');
    expect(out.orders[0]).toMatchObject({ id: 'o1', completedAt: expect.any(Date), total: 42001 });
    expect(out.orders[0].items[0]).toEqual({
      productId: 'p1',
      productName: 'Galon',
      sku: 'G19',
      unit: 'Galon',
      quantity: 2,
    });
  });

  it('internalCompleted: forwards an explicit cursor and numeric limit', async () => {
    service.listCompletedPage.mockResolvedValue({ orders: [], nextCursor: null });
    await controller.internalCompleted('cur1', '50');
    expect(service.listCompletedPage).toHaveBeenCalledWith('cur1', 50);
  });

  it('internalDepotSales: returns the summed total for the range', async () => {
    const out = await controller.internalDepotSales('d1', '2026-01-01', '2026-02-01');
    expect(out).toEqual({ depotId: 'd1', totalIdr: 150000 });
    const [depotId, from, to] = service.sumDepotSales.mock.calls[0];
    expect(depotId).toBe('d1');
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
  });

  it('internalDepotCustomers: maps aggregates, rounds spend and serialises dates (null-safe)', async () => {
    service.depotCustomerAggregates.mockResolvedValue([
      {
        customerId: 'c1',
        name: 'Budi',
        phone: '0811',
        orderCount: 3,
        totalSpent: 99999.6,
        firstOrderAt: new Date('2026-01-01T00:00:00.000Z'),
        lastOrderAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        customerId: 'c2',
        name: null,
        phone: null,
        orderCount: 0,
        totalSpent: 0,
        firstOrderAt: null,
        lastOrderAt: null,
      },
    ]);
    const out = await controller.internalDepotCustomers('d1');
    expect(out.customers[0]).toMatchObject({
      totalSpent: 100000,
      firstOrderAt: '2026-01-01T00:00:00.000Z',
    });
    expect(out.customers[1]).toMatchObject({ firstOrderAt: null, lastOrderAt: null });
  });

  it('internalCustomerOrders: maps to the CRM row shape and serialises the date', async () => {
    service.customerOrdersAtDepot.mockResolvedValue([
      {
        id: 'o1',
        orderNumber: 'HM-20260802-1',
        status: 'COMPLETED',
        total: 49999.7,
        createdAt: new Date('2026-08-02T00:00:00.000Z'),
      },
    ]);
    const out = await controller.internalCustomerOrders('d1', 'c1');
    expect(out.orders).toEqual([
      {
        id: 'o1',
        orderNumber: 'HM-20260802-1',
        status: 'COMPLETED',
        totalIdr: 50000,
        placedAt: '2026-08-02T00:00:00.000Z',
      },
    ]);
    expect(service.customerOrdersAtDepot).toHaveBeenCalledWith('d1', 'c1', undefined);
  });

  // A junk `limit` must not become NaN or 0 rows — it falls through to the service default.
  it('internalCustomerOrders: forwards a usable limit and drops an unusable one', async () => {
    await controller.internalCustomerOrders('d1', 'c1', '3');
    expect(service.customerOrdersAtDepot).toHaveBeenLastCalledWith('d1', 'c1', 3);
    for (const bad of ['abc', '0', '-2', '']) {
      await controller.internalCustomerOrders('d1', 'c1', bad);
      expect(service.customerOrdersAtDepot).toHaveBeenLastCalledWith('d1', 'c1', undefined);
    }
  });

  it('internalValues: batch-reads authoritative totals', async () => {
    await expect(controller.internalValues({ orderIds: ['o1'] } as never)).resolves.toEqual([
      { orderId: 'o1', total: 42000 },
    ]);
    expect(service.findOrderValues).toHaveBeenCalledWith(['o1']);
  });

  it('remindStale: defaults days/limit to undefined, else forwards numbers', async () => {
    await expect(controller.remindStale()).resolves.toEqual({ reminded: 4 });
    let call = service.remindStaleCustomers.mock.calls[0];
    expect(call[0]).toBeInstanceOf(Date);
    expect(call[1]).toBeUndefined();
    expect(call[2]).toBeUndefined();
    await controller.remindStale('14', '100');
    call = service.remindStaleCustomers.mock.calls[1];
    expect(call[1]).toBe(14);
    expect(call[2]).toBe(100);
  });

  it('get: reads one of the customer own orders', async () => {
    await expect(controller.get(customer, 'o1')).resolves.toMatchObject({ id: 'o1' });
    expect(service.getForCustomer).toHaveBeenCalledWith('cust-1', 'o1');
  });

  it('timeline: returns the loaded order status history', async () => {
    await expect(controller.timeline(customer, 'o1')).resolves.toEqual(['h1', 'h2']);
    expect(service.getForCustomer).toHaveBeenCalledWith('cust-1', 'o1');
  });

  it('cancel: forwards reason and token', async () => {
    await controller.cancel(customer, 'o1', { reason: 'changed mind' } as never, 'Bearer t');
    expect(service.cancel).toHaveBeenCalledWith('cust-1', 'o1', 'changed mind', 'Bearer t');
  });

  it('repeat: re-adds an order items to the cart', async () => {
    await expect(controller.repeat(customer, 'o1')).resolves.toEqual({ items: ['x'] });
    expect(service.repeat).toHaveBeenCalledWith('cust-1', 'o1');
  });

  it('getReview: returns the review (or null)', async () => {
    await expect(controller.getReview(customer, 'o1')).resolves.toBeNull();
    expect(service.getReview).toHaveBeenCalledWith('cust-1', 'o1');
  });

  it('review: maps rating/aspects/comment/tip, defaulting aspects to []', async () => {
    await controller.review(customer, 'o1', {
      rating: 5,
      comment: 'good',
      tipAmount: 2000,
    } as never);
    expect(service.reviewOrder).toHaveBeenCalledWith('cust-1', 'o1', {
      rating: 5,
      aspects: [],
      comment: 'good',
      tipAmount: 2000,
    });
    await controller.review(customer, 'o1', { rating: 4, aspects: ['FAST'] } as never);
    expect(service.reviewOrder).toHaveBeenLastCalledWith(
      'cust-1',
      'o1',
      expect.objectContaining({ aspects: ['FAST'] }),
    );
  });

  it('internalConfirm: confirms via payment-service and returns id + status', async () => {
    await expect(controller.internalConfirm('o1')).resolves.toEqual({
      orderId: 'o1',
      status: 'CONFIRMED',
    });
    expect(service.confirmPaid).toHaveBeenCalledWith('o1', 'payment-service');
  });

  it('internalRefund: records the refund amount and echoes the order id', async () => {
    await expect(controller.internalRefund('o1', { amount: 5000 } as never)).resolves.toEqual({
      orderId: 'o1',
    });
    expect(service.recordRefund).toHaveBeenCalledWith('o1', 5000);
  });

  it('internalTotal: reads the authoritative order total', async () => {
    await expect(controller.internalTotal('o1')).resolves.toEqual({ orderId: 'o1', total: 42000 });
    expect(service.getAny).toHaveBeenCalledWith('o1');
  });

  it('ratingBatch: returns the mean rating over the order ids', async () => {
    await expect(controller.ratingBatch({ orderIds: ['o1', 'o2'] } as never)).resolves.toEqual({
      average: 4.5,
      count: 2,
    });
    expect(service.ratingSummary).toHaveBeenCalledWith(['o1', 'o2']);
  });

  it('updateStatus: loads the order, passes the access check, forwards status + driver fields + token', async () => {
    const dto = {
      status: 'DELIVERED',
      note: 'left at door',
      driverName: 'Andi',
      driverPhone: '0822',
      estimatedArrivalAt: '2026-01-01T10:00:00.000Z',
    } as never;
    await expect(controller.updateStatus(admin, 'o1', dto, 'Bearer t')).resolves.toMatchObject({
      status: 'DELIVERED',
    });
    expect(service.getAny).toHaveBeenCalledWith('o1');
    expect(service.updateStatus).toHaveBeenCalledWith(
      'o1',
      'DELIVERED',
      'admin-1',
      'left at door',
      'Bearer t',
      'Andi',
      '0822',
      '2026-01-01T10:00:00.000Z',
    );
  });

  // H-10: the sweep is how a stock consume or an owner credit that failed at completion
  // time eventually lands. Ops-scheduled, so the route has to exist and be SUPER_ADMIN.
  it('outbox: runs the sweep and reports what is still owed', async () => {
    await expect(controller.processOutbox()).resolves.toMatchObject({ delivered: 2 });
    await expect(controller.outboxPending()).resolves.toMatchObject({ PENDING: 1 });
  });

  /*
   * The scheduler's own doors.
   *
   * Both sweeps existed only behind @Roles(SUPER_ADMIN), and `sweep.sh` carries an
   * `x-internal-key` and no JWT — so neither could ever be given a cron line, and neither
   * had one. The outbox retry path never ran, and abandoned orders kept their stock
   * reservation for good. These two routes are what make the schedule possible, so the
   * test that matters is the auth shape: internal-key only, never a bearer.
   */
  it('exposes both sweeps to the scheduler under the internal key, not a JWT', async () => {
    await expect(controller.processOutboxInternal()).resolves.toMatchObject({ delivered: 2 });
    await expect(controller.expireAbandonedInternal()).resolves.toEqual({ cancelled: 3 });

    // No user to attribute it to, so the history row names the sweep itself — and the
    // empty bearer is safe because releaseStock reaches depot-service with the internal key.
    expect(service.expireAbandoned).toHaveBeenLastCalledWith('system:scheduler');

    for (const handler of [
      OrderController.prototype.processOutboxInternal,
      OrderController.prototype.expireAbandonedInternal,
    ]) {
      // @Public() takes it out of the global JwtAuthGuard; InternalAuthGuard is the sole auth.
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(CAPABILITY_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata('__guards__', handler)).toContain(InternalAuthGuard);
    }
  });
});
