import { OrderController } from '../../src/modules/order.controller';
import { OrderService } from '../../src/application/services/order.service';

type Mocked = { [K in keyof OrderService]: jest.Mock };

// SUPER_ADMIN so the real assertDepotAccess / depotScopeFilter guards are no-ops and we can
// exercise the controller's own mapping logic (the depot-lock branches live in @hydromart/platform).
const admin = { sub: 'admin-1', role: 'SUPER_ADMIN' } as never;
const customer = { sub: 'cust-1', role: 'CUSTOMER' } as never;

function makeService(): Mocked {
  return {
    checkout: jest.fn().mockResolvedValue({ id: 'o1' }),
    expireAbandoned: jest.fn().mockResolvedValue({ cancelled: 3 }),
    listForCustomer: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listAll: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getAny: jest.fn().mockResolvedValue({ id: 'o1', depotId: 'd1', total: 42000 }),
    listCompletedPage: jest.fn(),
    sumDepotSales: jest.fn().mockResolvedValue(150000),
    depotCustomerAggregates: jest.fn(),
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

  beforeEach(() => {
    service = makeService();
    controller = new OrderController(service as unknown as OrderService);
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
  });

  it('checkout: preserves supplied voucher, window and optional address fields', async () => {
    const dto = {
      deliveryAddress: { ...address, postalCode: '40111', latitude: -6.9, longitude: 107.6, notes: 'n' },
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
    await expect(controller.expireAbandoned(admin, 'Bearer t', '30')).resolves.toEqual({ cancelled: 3 });
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
    expect(service.listAll).toHaveBeenCalledWith({ depotId: 'd9', limit: 10 });
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
          items: [{ productId: 'p1', productName: 'Galon', sku: 'G19', unit: 'Galon', quantity: 2 }],
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
    expect(out.customers[0]).toMatchObject({ totalSpent: 100000, firstOrderAt: '2026-01-01T00:00:00.000Z' });
    expect(out.customers[1]).toMatchObject({ firstOrderAt: null, lastOrderAt: null });
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
    await controller.review(customer, 'o1', { rating: 5, comment: 'good', tipAmount: 2000 } as never);
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
});
