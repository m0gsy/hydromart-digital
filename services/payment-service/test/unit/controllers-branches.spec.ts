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

describe('PaymentController', () => {
  const svc = {
    initiate: jest.fn(),
    listForCustomer: jest.fn(),
    listAll: jest.fn(),
    unsettledByMethod: jest.fn(),
    revenueByMethod: jest.fn(),
    cashCollected: jest.fn(),
    listRefundQueue: jest.fn(),
    getForCustomer: jest.fn(),
    confirm: jest.fn(),
    fail: jest.fn(),
    refund: jest.fn(),
    approveRefund: jest.fn(),
    rejectRefund: jest.fn(),
    handleWebhook: jest.fn(),
  };
  const controller = new PaymentController(svc as unknown as PaymentService);

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(svc).forEach((fn) => fn.mockResolvedValue('RESULT'));
  });

  it('initiate forwards the customer id + dto', async () => {
    const dto = { orderId: 'o1', method: 'CASH', amount: 45000 } as never;
    expect(await controller.initiate(user, dto)).toBe('RESULT');
    expect(svc.initiate).toHaveBeenCalledWith('user-1', dto);
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

  it('cashCollected forwards the order ids', async () => {
    await controller.cashCollected({ orderIds: ['o1', 'o2'] } as never);
    expect(svc.cashCollected).toHaveBeenCalledWith(['o1', 'o2']);
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
