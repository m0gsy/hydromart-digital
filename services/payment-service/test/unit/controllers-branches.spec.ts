import { ServiceUnavailableException } from '@nestjs/common';

import { PaymentController } from '../../src/modules/payment.controller';
import { TaxController } from '../../src/modules/tax.controller';
import { HealthController } from '../../src/modules/health.controller';
import type { PaymentService } from '../../src/application/services/payment.service';
import type { TaxSettingsService } from '../../src/application/services/tax-settings.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '@hydromart/platform';

// Delegate-assert: the controllers are thin — every handler forwards to a service
// method and returns its result. These specs assert the wiring (args, return
// pass-through, query→Date mapping branches) with a mocked service. No Nest DI.

const user = { sub: 'user-1' } as AuthenticatedUser;
const ISO = '2026-08-03T01:00:00.000Z';

describe('PaymentController', () => {
  const svc = {
    initiate: jest.fn(),
    listForCustomer: jest.fn(),
    listAll: jest.fn(),
    listForOrders: jest.fn(),
    refundCountsByCustomer: jest.fn(),
    unsettledByMethod: jest.fn(),
    revenueByMethod: jest.fn(),
    cashCollected: jest.fn(),
    depotCashCollected: jest.fn(),
    voidForOrder: jest.fn(),
    expireStalePending: jest.fn(),
    cancelForOrder: jest.fn(),
    listRefundQueue: jest.fn(),
    getForCustomer: jest.fn(),
    confirm: jest.fn(),
    fail: jest.fn(),
    refund: jest.fn(),
    approveRefund: jest.fn(),
    rejectRefund: jest.fn(),
    handleWebhook: jest.fn(),
    availableMethods: jest.fn(),
  };
  const controller = new PaymentController(svc as unknown as PaymentService);

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(svc).forEach((fn) => fn.mockResolvedValue('RESULT'));
  });

  // O5: the screen needs one answer to "which methods can this take", and there was no
  // endpoint that could give it — so it offered all five and let two fail at the gateway.
  it('answers which payment methods are available', () => {
    svc.availableMethods.mockReturnValue({ CASH: true, TRANSFER: true, QRIS: true, EWALLET: false, VA: false });
    expect(controller.methods()).toMatchObject({ EWALLET: false, VA: false });
    expect(svc.availableMethods).toHaveBeenCalled();
  });

  it('initiate forwards the customer id + dto', async () => {
    const dto = { orderId: 'o1', method: 'CASH', amount: 45000 } as never;
    expect(await controller.initiate(user, dto)).toBe('RESULT');
    expect(svc.initiate).toHaveBeenCalledWith('user-1', dto);
  });

  it('staff initiate bills the buyer in the body, not the cashier holding the token', async () => {
    const dto = { orderId: 'o1', method: 'CASH', amount: 45000, customerId: 'buyer-9' };
    expect(await controller.initiateForCustomer(dto as never, 'Bearer cashier-token')).toBe('RESULT');
    // atCounter marks it a counter sale, which changes the CASH instruction copy.
    // C2: the cashier's own bearer rides along so the service can ask depot-service which
    // drawer THEY have open. It is not a body field on purpose — a body that could name the
    // shift could name somebody else's till.
    expect(svc.initiate).toHaveBeenCalledWith('buyer-9', {
      ...dto,
      atCounter: true,
      authorization: 'Bearer cashier-token',
    });
  });

  it('list scopes to the current customer', async () => {
    const query = { page: 1 } as never;
    expect(await controller.list(user, query)).toBe('RESULT');
    expect(svc.listForCustomer).toHaveBeenCalledWith('user-1', query);
  });

  it('listForOrder reads an order across customers with a fixed limit', async () => {
    expect(await controller.listForOrder('order-9')).toBe('RESULT');
    expect(svc.listAll).toHaveBeenCalledWith({ orderId: 'order-9', limit: 20 });
  });

  /*
   * delivery-service asks this one when it decides cash-on-delivery, and it must be the
   * SAME read as the staff route — a second query here is a second answer waiting to
   * disagree about whether the courier collects.
   */
  it('the internal twin runs the identical query as the staff route', async () => {
    expect(await controller.listForOrderInternal('order-9')).toBe('RESULT');
    expect(svc.listAll).toHaveBeenCalledWith({ orderId: 'order-9', limit: 20 });
  });

  it('listForOrders forwards the id set from the body', async () => {
    expect(await controller.listForOrders({ orderIds: ['o1', 'o2'] })).toBe('RESULT');
    expect(svc.listForOrders).toHaveBeenCalledWith(['o1', 'o2']);
  });

  it('refundCounts maps the ISO window to Dates and wraps the rows', async () => {
    svc.refundCountsByCustomer.mockResolvedValueOnce([
      { customerId: 'c1', refunds: 4, amountIdr: 240000 },
    ]);
    const out = await controller.refundCounts({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      minRefunds: 3,
    });
    expect(svc.refundCountsByCustomer).toHaveBeenCalledWith(
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-08-01T00:00:00.000Z'),
      3,
    );
    expect(out).toEqual({ customers: [{ customerId: 'c1', refunds: 4, amountIdr: 240000 }] });
  });

  it('unsettledByMethod maps a present from/to window to Dates', async () => {
    await controller.unsettledByMethod({ from: '2026-01-01', to: '2026-01-31' } as never);
    expect(svc.unsettledByMethod).toHaveBeenCalledWith({
      from: new Date('2026-01-01'),
      to: new Date('2026-01-31'),
    });
  });

  it('unsettledByMethod passes undefined when the window is absent', async () => {
    await controller.unsettledByMethod({} as never);
    expect(svc.unsettledByMethod).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });

  it('revenueByMethod maps a present from/to window to Dates', async () => {
    await controller.revenueByMethod({ from: '2026-02-01', to: '2026-02-28' } as never);
    expect(svc.revenueByMethod).toHaveBeenCalledWith({
      from: new Date('2026-02-01'),
      to: new Date('2026-02-28'),
    });
  });

  it('revenueByMethod passes undefined when the window is absent', async () => {
    await controller.revenueByMethod({} as never);
    expect(svc.revenueByMethod).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });

  // The sweep's twin. Same aggregate, flattened to the row shape the spreadsheet writer
  // takes — if this drifted from order-service's rows the report would have two layouts.
  it('internalExportRows flattens the method aggregate to label/orders/revenue', async () => {
    svc.revenueByMethod.mockResolvedValue([{ method: 'CASH', amount: 50000, count: 3 }]);
    await expect(controller.internalExportRows({} as never)).resolves.toEqual({
      rows: [{ label: 'CASH', orders: 3, revenue: 50000 }],
    });
    expect(svc.revenueByMethod).toHaveBeenLastCalledWith({ from: undefined, to: undefined });
  });

  it('internalExportRows maps a present window to Dates', async () => {
    svc.revenueByMethod.mockResolvedValue([]);
    await controller.internalExportRows({ from: '2026-02-01', to: '2026-02-28' } as never);
    expect(svc.revenueByMethod).toHaveBeenLastCalledWith({
      from: new Date('2026-02-01'),
      to: new Date('2026-02-28'),
    });
  });

  // Shift close reads this. An open window means "everything so far", which is what a
  // depot's running total is before anyone has closed anything.
  // K2.2: the scheduler's route. crond holds no bearer, so this is internal-key only.
  it('expirePending runs the stale-payment sweep and returns its verdict', async () => {
    svc.expireStalePending.mockResolvedValue({ expired: 2, failed: 0, ok: true });
    await expect(controller.expirePending()).resolves.toEqual({ expired: 2, failed: 0, ok: true });
    expect(svc.expireStalePending).toHaveBeenCalledWith(expect.any(Date));
  });

  it('depotCash forwards the window, open at both ends when unbounded', async () => {
    await controller.depotCash({ depotId: 'depot-1' } as never);
    expect(svc.depotCashCollected).toHaveBeenCalledWith(
      'depot-1',
      { from: undefined, to: undefined },
      undefined,
    );
    await controller.depotCash({ depotId: 'depot-1', from: ISO, to: ISO } as never);
    expect(svc.depotCashCollected).toHaveBeenLastCalledWith(
      'depot-1',
      { from: new Date(ISO), to: new Date(ISO) },
      undefined,
    );
  });

  // C2: a shift close names itself, and that is what turns "this depot's window" into
  // "this drawer". Two cashiers open at once used to each claim the whole window.
  it('depotCash forwards the shift when the caller is a shift close', async () => {
    await controller.depotCash({ depotId: 'depot-1', from: ISO, to: ISO, cashierShiftId: 'shift-7' } as never);
    expect(svc.depotCashCollected).toHaveBeenLastCalledWith(
      'depot-1',
      { from: new Date(ISO), to: new Date(ISO) },
      'shift-7',
    );
  });

  // The actor is the service, not a person: a counter void must not need a MANAGER at the
  // depot, and `refundIssue` rightly excludes whoever took the cash.
  // K2.3: a separate route from void-for-order, and attributed the same way — the caller
  // is a service, not a person holding a token.
  it('cancelForOrder is attributed to order-service, not a token holder', async () => {
    svc.cancelForOrder.mockResolvedValue(null);
    await controller.cancelForOrder({ orderId: 'order-9', reason: 'Dibatalkan' } as never);
    expect(svc.cancelForOrder).toHaveBeenCalledWith('order-9', 'Dibatalkan', 'order-service');
  });

  it('voidForOrder is attributed to order-service, not a token holder', async () => {
    await controller.voidForOrder({ orderId: 'order-9', reason: 'Salah ukuran' } as never);
    expect(svc.voidForOrder).toHaveBeenCalledWith('order-9', 'Salah ukuran', 'order-service');
  });

  it('cashCollectedByOrder forwards the order ids from the body', async () => {
    await controller.cashCollectedByOrder({ orderIds: ['o1', 'o2'] } as never);
    expect(svc.cashCollected).toHaveBeenCalledWith(['o1', 'o2']);
  });

  // Both routes now answer off the one per-order read: the GET is what delivery-service
  // settles against (C1), and it needs the split, not just the total.
  it('cashCollected forwards the order ids from the query', async () => {
    await controller.cashCollected({ orderIds: ['o3', 'o4'] } as never);
    expect(svc.cashCollected).toHaveBeenCalledWith(['o3', 'o4']);
  });

  it('listRefundQueue forwards the query', async () => {
    const query = { limit: 5 } as never;
    await controller.listRefundQueue(query);
    expect(svc.listRefundQueue).toHaveBeenCalledWith(query);
  });

  it('get scopes to the current customer', async () => {
    await controller.get(user, 'pay-1');
    expect(svc.getForCustomer).toHaveBeenCalledWith('user-1', 'pay-1');
  });

  it('confirm forwards id, actor and cashReceived', async () => {
    await controller.confirm(user, 'pay-1', { cashReceived: 50000 } as never);
    expect(svc.confirm).toHaveBeenCalledWith('pay-1', 'user-1', 50000);
  });

  it('fail forwards id and actor', async () => {
    await controller.fail(user, 'pay-1');
    expect(svc.fail).toHaveBeenCalledWith('pay-1', 'user-1');
  });

  it('refund forwards id, actor and reason', async () => {
    await controller.refund(user, 'pay-1', { reason: 'cancelled' } as never);
    expect(svc.refund).toHaveBeenCalledWith('pay-1', 'user-1', 'cancelled');
  });

  it('approveRefund forwards id and actor', async () => {
    await controller.approveRefund(user, 'pay-1');
    expect(svc.approveRefund).toHaveBeenCalledWith('pay-1', 'user-1');
  });

  it('rejectRefund forwards id, actor and reason', async () => {
    await controller.rejectRefund(user, 'pay-1', { reason: 'invalid' } as never);
    expect(svc.rejectRefund).toHaveBeenCalledWith('pay-1', 'user-1', 'invalid');
  });

  it('webhook forwards the signed payload', async () => {
    const dto = { reference: 'REF', event: 'PAID', signature: 'sig' } as never;
    await controller.webhook(dto);
    expect(svc.handleWebhook).toHaveBeenCalledWith(dto);
  });
});

describe('TaxController', () => {
  const record = {
    ppnPercent: 11,
    priceIncludesTax: true,
    invoiceFormat: 'INV',
    companyName: 'HM',
    npwp: '00',
    address: 'JKT',
    updatedAt: new Date('2026-01-01'),
  };
  const svc = { get: jest.fn(), update: jest.fn() };
  const controller = new TaxController(svc as unknown as TaxSettingsService);

  beforeEach(() => jest.clearAllMocks());

  it('get maps the record through the DTO', async () => {
    svc.get.mockResolvedValue(record);
    const out = await controller.get();
    expect(out.ppnPercent).toBe(11);
    expect(out.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('update forwards the dto and maps the result', async () => {
    const dto = { ppnPercent: 12 } as never;
    svc.update.mockResolvedValue({ ...record, ppnPercent: 12 });
    const out = await controller.update(dto);
    expect(svc.update).toHaveBeenCalledWith(dto);
    expect(out.ppnPercent).toBe(12);
  });
});

describe('HealthController', () => {
  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    const out = await controller.check();
    expect(out.status).toBe('ok');
    expect(out.checks.database).toBe('up');
  });

  it('throws 503 with a down check when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('no db')) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
