import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CustomerOutreachRepository, StatusOrderRow } from '../../src/application/ports/customer-outreach.repository';
import { OrderPaymentRow } from '../../src/application/ports/outreach-lookups.port';
import { CustomerOutreachService } from '../../src/application/services/customer-outreach.service';
import { OrderConfigService } from '../../src/config/order-config.service';
import { OrderAuditSink } from '../../src/infrastructure/http/order-audit.sink';
import {
  AccountByPhoneHttpAdapter,
  PaymentsOfOrdersHttpAdapter,
} from '../../src/infrastructure/http/outreach-lookups.http.adapter';
import { CustomerOutreachPrismaRepository } from '../../src/infrastructure/prisma/customer-outreach.prisma.repository';
import { CustomerRemindersInternalController, MachineOrdersController } from '../../src/modules/customer-outreach.controller';
import { DueWindowDto, MachineOrdersByPhoneDto } from '../../src/modules/dto/customer-outreach.dto';
import { abandonSweepEligible } from '../../src/domain/abandon-sweep';
import { redactBody } from '@hydromart/platform';

const NOW = new Date('2026-11-25T10:00:00.000Z'); // 17:00 WIB
const row = (over: Partial<StatusOrderRow> = {}): StatusOrderRow => ({
  id: 'o1',
  orderNumber: 'HM-20261125-000001',
  createdAt: new Date('2026-11-24T20:30:00.000Z'), // 03:30 WIB the next day: the WIB date must win
  status: 'ON_DELIVERY',
  total: 45000,
  depotId: 'd1',
  deliveryWindow: '09:00-12:00',
  scheduledFor: new Date('2026-11-25T02:00:00.000Z'),
  items: [{ productName: 'Galon 19L', quantity: 2 }],
  ...over,
});

const build = (
  over: {
    repo?: Partial<CustomerOutreachRepository>;
    customerId?: string | null;
    payments?: () => Promise<Map<string, OrderPaymentRow>>;
    contacts?: () => Promise<{ id: string; name: string }[] | null>;
    active?: () => Promise<unknown[] | null>;
    saved?: (customerId: string, addressId: string) => Promise<unknown | null>;
    abandon?: number;
  } = {},
) => {
  const repo: CustomerOutreachRepository = {
    statusOrders: jest.fn().mockResolvedValue({ running: [row()], recent: [] }),
    subscriptionsDueBetween: jest.fn().mockResolvedValue([]),
    createdOrdersBetween: jest.fn().mockResolvedValue([]),
    ...over.repo,
  };
  const accounts = { customerIdByPhone: jest.fn().mockResolvedValue(over.customerId === undefined ? 'c1' : over.customerId) };
  const payments = {
    latestByOrder: jest.fn(over.payments ?? (async () => new Map([['o1', { orderId: 'o1', method: 'TRANSFER', status: 'PENDING' }]]))),
  };
  const depots = {
    listContacts: jest.fn(over.contacts ?? (async () => [{ id: 'd1', name: 'Depot Pekayon' }])),
    listActiveDepots: jest.fn(over.active ?? (async () => [])),
  };
  const config = { abandonMinutes: over.abandon ?? 60 } as unknown as OrderConfigService;
  const customers = { addressById: jest.fn(over.saved ?? (async () => null)) };
  const service = new CustomerOutreachService(repo, accounts, payments, depots as never, customers as never, config);
  return { service, repo, accounts, payments, depots, customers };
};

describe('CustomerOutreachService.statusByPhone (HD-18)', () => {
  it('answers running orders then recent ones with payment, depot and WIB times, and nothing personal', async () => {
    const { service, repo } = build({
      repo: { statusOrders: jest.fn().mockResolvedValue({ running: [row()], recent: [row({ id: 'o2', status: 'COMPLETED', depotId: null, scheduledFor: null })] }) },
      payments: async () => new Map([['o1', { orderId: 'o1', method: 'QRIS', status: 'PAID' }]]),
    });
    const out = await service.statusByPhone('0812');
    expect(repo.statusOrders).toHaveBeenCalledWith('c1', 3);
    expect(out.orders).toHaveLength(2);
    expect(out.orders[0]).toEqual({
      orderNumber: 'HM-20261125-000001',
      createdAt: '2026-11-25 03:30',
      items: [{ name: 'Galon 19L', quantity: 2 }],
      total: 45000,
      paymentStatus: 'PAID',
      paymentMethod: 'QRIS',
      status: 'ON_DELIVERY',
      depot: 'Depot Pekayon',
      deliveryWindow: '09:00-12:00',
      scheduledFor: '2026-11-25 09:00',
    });
    expect(out.orders[1]).toMatchObject({ paymentStatus: null, paymentMethod: null, depot: null, scheduledFor: null });
    const keys = JSON.stringify(out);
    for (const secret of ['address', 'recipient', 'driver', 'phone', 'customerId']) expect(keys.toLowerCase()).not.toContain(secret);
  });

  it('says an empty list for a number nobody holds and for a holder with no orders', async () => {
    const unknown = build({ customerId: null });
    await expect(unknown.service.statusByPhone('0800')).resolves.toEqual({ orders: [] });
    expect(unknown.repo.statusOrders).not.toHaveBeenCalled();
    const none = build({ repo: { statusOrders: jest.fn().mockResolvedValue({ running: [], recent: [] }) } });
    await expect(none.service.statusByPhone('0812')).resolves.toEqual({ orders: [] });
    expect(none.payments.latestByOrder).not.toHaveBeenCalled();
  });

  it('still answers when payment-service or the depot list cannot be read', async () => {
    const { service } = build({
      payments: async () => {
        throw new Error('down');
      },
      contacts: async () => {
        throw new Error('down');
      },
    });
    const out = await service.statusByPhone('0812');
    expect(out.orders[0]).toMatchObject({ paymentStatus: null, depot: null });
    const nullContacts = build({ contacts: async () => null });
    expect((await nullContacts.service.statusByPhone('0812')).orders[0].depot).toBeNull();
  });

  it('answers a fixed 503 when auth-service or the database fails, never "no orders" and never the number', async () => {
    const { service, accounts } = build();
    accounts.customerIdByPhone.mockRejectedValue(new Error('auth down for 0812'));
    const err = await service.statusByPhone('0812').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify(err.getResponse())).not.toMatch(/0812|auth down/);
    const dbDown = build({ repo: { statusOrders: jest.fn().mockRejectedValue(new Error('prisma')) } });
    await expect(dbDown.service.statusByPhone('0812')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('CustomerOutreachService reminders (HD-18)', () => {
  it('hands the subscription window to the repository', async () => {
    const { service, repo } = build();
    const from = new Date('2026-11-25T17:00:00Z');
    const to = new Date('2026-11-26T17:00:00Z');
    await expect(service.subscriptionsDue(from, to)).resolves.toEqual({ items: [], truncated: false });
    expect(repo.subscriptionsDueBetween).toHaveBeenCalledWith(from, to, 1001);
  });

  it('keeps 1000 subscriptions and says when there were more', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `s${i}` }));
    const { service } = build({ repo: { subscriptionsDueBetween: jest.fn().mockResolvedValue(rows) } });
    const out = await service.subscriptionsDue(new Date(), new Date());
    expect(out.items).toHaveLength(1000);
    expect(out.truncated).toBe(true);
  });

  it('keeps the 200 oldest unpaid orders and says when there were more', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ id: `o${i}`, customerId: 'c', orderNumber: `n${i}`, total: 1 }));
    const { service, repo } = build({
      repo: { createdOrdersBetween: jest.fn().mockResolvedValue(rows) },
      payments: async () => new Map(rows.map((r) => [r.id, { orderId: r.id, method: 'QRIS', status: 'PENDING' }])),
    });
    const out = await service.unpaidOrders(NOW);
    expect((repo.createdOrdersBetween as jest.Mock).mock.calls[0][2]).toBe(201);
    expect(out.items).toHaveLength(200);
    expect(out.items[199].orderId).toBe('o199');
    expect(out.truncated).toBe(true);
  });

  it('asks for CREATED orders between 2/3 of the abandon window and the abandon window, keeping pending transfer/QR payments only', async () => {
    const c = (id: string) => ({ id, customerId: `c-${id}`, orderNumber: `HM-${id}`, total: 1000 });
    const { service, repo } = build({
      repo: { createdOrdersBetween: jest.fn().mockResolvedValue([c('a'), c('b'), c('c'), c('d'), c('e')]) },
      payments: async () =>
        new Map<string, OrderPaymentRow>([
          ['a', { orderId: 'a', method: 'TRANSFER', status: 'PENDING' }],
          ['b', { orderId: 'b', method: 'QRIS', status: 'PENDING' }],
          ['c', { orderId: 'c', method: 'CASH', status: 'PENDING' }],
          ['d', { orderId: 'd', method: 'TRANSFER', status: 'PAID' }],
        ]),
    });
    const out = await service.unpaidOrders(NOW);
    const [after, upTo] = (repo.createdOrdersBetween as jest.Mock).mock.calls[0];
    expect(NOW.getTime() - after.getTime()).toBe(60 * 60_000); // never older than the sweep's cut-off
    expect(NOW.getTime() - upTo.getTime()).toBe(40 * 60_000); // two thirds of the way
    expect(out.items.map((i) => i.orderId)).toEqual(['a', 'b']);
    expect(out.truncated).toBe(false);
    expect(out.items[0]).toEqual({ orderId: 'a', customerId: 'c-a', orderNumber: 'HM-a', total: 1000 });
  });

  it('follows a retuned abandon window and fails when payment-service cannot answer', async () => {
    const tuned = build({ abandon: 90 });
    await tuned.service.unpaidOrders(NOW);
    const [after, upTo] = (tuned.repo.createdOrdersBetween as jest.Mock).mock.calls[0];
    expect([NOW.getTime() - after.getTime(), NOW.getTime() - upTo.getTime()]).toEqual([90 * 60_000, 60 * 60_000]);
    const down = build({
      repo: { createdOrdersBetween: jest.fn().mockResolvedValue([{ id: 'a', customerId: 'c', orderNumber: 'n', total: 1 }]) },
      payments: async () => {
        throw new Error('pay down');
      },
    });
    await expect(down.service.unpaidOrders(NOW)).rejects.toThrow('pay down');
  });
});

describe('controllers (HD-18)', () => {
  it('the machine route answers the service result for the number in the body', async () => {
    const { service } = build();
    const ctrl = new MachineOrdersController(service);
    const out = await ctrl.byPhone({ msisdn: '0812' });
    expect(out.orders).toHaveLength(1);
  });

  it('the internal routes turn the dto into dates', async () => {
    const outreach = { subscriptionsDue: jest.fn().mockResolvedValue({ items: [] }), unpaidOrders: jest.fn().mockResolvedValue({ items: [] }) };
    const ctrl = new CustomerRemindersInternalController(outreach as never);
    await ctrl.subscriptionsDue({ from: '2026-11-25T17:00:00.000Z', to: '2026-11-26T17:00:00.000Z' });
    expect(outreach.subscriptionsDue).toHaveBeenCalledWith(new Date('2026-11-25T17:00:00.000Z'), new Date('2026-11-26T17:00:00.000Z'));
    await ctrl.unpaidOrders();
    expect(outreach.unpaidOrders).toHaveBeenCalledWith(expect.any(Date));
  });

  it('keeps the number out of the audit trail and validates the body', async () => {
    expect(redactBody({ msisdn: '081234567890' })).toEqual({ msisdn: '[redacted]' });
    const good = plainToInstance(MachineOrdersByPhoneDto, { msisdn: '0812' });
    expect(await validate(good)).toHaveLength(0);
    expect(await validate(plainToInstance(MachineOrdersByPhoneDto, { msisdn: '' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(MachineOrdersByPhoneDto, { msisdn: 'x'.repeat(33) }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DueWindowDto, { from: 'x', to: 'y' }))).not.toHaveLength(0);
  });
});

describe('http adapters (HD-18)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = (over: Record<string, string> = {}) =>
    ({ authServiceUrl: 'http://auth:3001', paymentServiceUrl: 'http://pay:3007', internalServiceKey: 'k', ...over }) as unknown as OrderConfigService;
  const answer = (body: unknown, ok = true) => jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 502, json: async () => body });

  it('looks a customer up by phone in auth-service, read-only', async () => {
    const f = answer({ customerId: 'c1' });
    global.fetch = f as never;
    await expect(new AccountByPhoneHttpAdapter(config()).customerIdByPhone('0812')).resolves.toBe('c1');
    expect(f.mock.calls[0][0]).toBe('http://auth:3001/api/v1/auth/internal/customers/by-phone');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ phone: '0812' });
    global.fetch = answer({ customerId: null }) as never;
    await expect(new AccountByPhoneHttpAdapter(config()).customerIdByPhone('0812')).resolves.toBeNull();
  });

  it('throws, never answers "none", when auth-service cannot answer', async () => {
    global.fetch = answer({}, false) as never;
    await expect(new AccountByPhoneHttpAdapter(config()).customerIdByPhone('0812')).rejects.toThrow('auth-service responded 502');
    const unconfigured = jest.fn();
    global.fetch = unconfigured as never;
    await expect(new AccountByPhoneHttpAdapter(config({ authServiceUrl: '' })).customerIdByPhone('0812')).rejects.toThrow('missing');
    expect(unconfigured).not.toHaveBeenCalled();
  });

  it('keeps the newest payment per order and skips malformed rows', async () => {
    const f = answer([
      { orderId: 'o1', method: 'QRIS', status: 'PENDING' },
      { orderId: 'o1', method: 'TRANSFER', status: 'FAILED' },
      { orderId: 'o2', method: 'CASH' },
      null,
    ]);
    global.fetch = f as never;
    const adapter = new PaymentsOfOrdersHttpAdapter(config());
    const map = await adapter.latestByOrder(['o1', 'o2']);
    expect([...map.keys()]).toEqual(['o1']);
    expect(map.get('o1')).toEqual({ orderId: 'o1', method: 'QRIS', status: 'PENDING' });
    expect(f.mock.calls[0][0]).toBe('http://pay:3007/api/v1/payments/for-orders');
    expect((await adapter.latestByOrder([])).size).toBe(0);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('refuses a payment answer that is not a list', async () => {
    global.fetch = answer({ nope: true }) as never;
    await expect(new PaymentsOfOrdersHttpAdapter(config()).latestByOrder(['o1'])).rejects.toThrow('malformed');
  });
});

describe('CustomerOutreachPrismaRepository (HD-18)', () => {
  const dec = (n: number) => ({ toNumber: () => n });
  it('selects named columns only and splits running from finished', async () => {
    const findMany = jest.fn().mockResolvedValueOnce([{ id: 'o1', total: dec(10) }]).mockResolvedValueOnce([{ id: 'o2', total: dec(20) }]);
    const repo = new CustomerOutreachPrismaRepository({ order: { findMany } } as never);
    const out = await repo.statusOrders('c1', 3);
    expect(out).toEqual({ running: [{ id: 'o1', total: 10 }], recent: [{ id: 'o2', total: 20 }] });
    const [running, recent] = findMany.mock.calls.map((c) => c[0]);
    expect(running.where.status.in).toContain('CREATED');
    expect(recent.where.status.notIn).toEqual(running.where.status.in);
    expect(recent.take).toBe(3);
    for (const q of [running, recent]) {
      expect(Object.keys(q.select)).not.toEqual(expect.arrayContaining(['addressLine']));
      expect(q.select.driverName).toBeUndefined();
      expect(q.select.recipientName).toBeUndefined();
    }
  });

  it('reads active subscriptions due in a window', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 's1' }]);
    const repo = new CustomerOutreachPrismaRepository({ subscription: { findMany } } as never);
    const from = new Date('2026-11-25T17:00:00Z');
    const to = new Date('2026-11-26T17:00:00Z');
    await expect(repo.subscriptionsDueBetween(from, to, 50)).resolves.toEqual([{ id: 's1' }]);
    expect(findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE', nextDeliveryAt: { gte: from, lt: to } });
  });

  it('reads CREATED delivery orders of named customers, not subscription or counter ones', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'o1', customerId: 'c', orderNumber: 'n', total: dec(5) }]);
    const repo = new CustomerOutreachPrismaRepository({ order: { findMany } } as never);
    const after = new Date('2026-11-25T09:00:00Z');
    const upTo = new Date('2026-11-25T09:20:00Z');
    await expect(repo.createdOrdersBetween(after, upTo, 10)).resolves.toEqual([{ id: 'o1', customerId: 'c', orderNumber: 'n', total: 5 }]);
    // The sweep's own exemptions, judged at the window's lower edge: a booked slot after it is not reminded.
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ scheduledFor: null }, { scheduledFor: { lt: after } }]);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      status: 'CREATED',
      isWalkIn: false,
      subscriptionId: null,
      statusChangedAt: { gt: after, lte: upTo },
    });
  });
});

describe('reminders skip a depot on quality hold (HD-14)', () => {
  // Two depots a few km apart; the plan near d-held routes to it.
  const depot = (id: string, lat: number, onHold: boolean) => ({ id, lat, lng: 106.8, serviceRadiusKm: 10, deliveryFee: 0, minOrderAmount: null, onHold });
  const active = async () => [depot('d-held', -6.2, true), depot('d-ok', -6.5, false)];
  const sub = (id: string, lat: number | null, over: Record<string, unknown> = {}) => ({
    id, customerId: 'c', productName: 'Galon', quantity: 1, nextDeliveryAt: NOW, addressId: null,
    recipientName: 'A', phone: '08', addressLine: 'Jl', city: 'X', province: null, postalCode: null, notes: null,
    latitude: lat, longitude: lat === null ? null : 106.8, ...over,
  });

  it('drops the subscription reminders of a held depot, keeps the others and a plan with no pin', async () => {
    const { service } = build({
      active,
      repo: { subscriptionsDueBetween: jest.fn().mockResolvedValue([sub('near-held', -6.2), sub('near-ok', -6.5), sub('nopin', null)]) },
    });
    const out = await service.subscriptionsDue(NOW, NOW);
    expect(out.items.map((i) => i.id)).toEqual(['near-ok', 'nopin']);
    // The coordinates are for routing only and never leave.
    expect(JSON.stringify(out)).not.toMatch(/latitude/);
  });

  it('with no depot on hold the list is unchanged (and the depots are still read)', async () => {
    const { service } = build({ active: async () => [depot('d-ok', -6.5, false)], repo: { subscriptionsDueBetween: jest.fn().mockResolvedValue([sub('a', -6.5)]) } });
    expect((await service.subscriptionsDue(NOW, NOW)).items).toHaveLength(1);
  });

  it('drops the unpaid-order reminders of a held depot', async () => {
    const o = (id: string, depotId: string | null) => ({ id, customerId: 'c', orderNumber: id, total: 1, depotId });
    const { service } = build({
      active,
      repo: { createdOrdersBetween: jest.fn().mockResolvedValue([o('h', 'd-held'), o('k', 'd-ok'), o('n', null)]) },
      payments: async () => new Map(['h', 'k', 'n'].map((id) => [id, { orderId: id, method: 'QRIS', status: 'PENDING' }] as [string, OrderPaymentRow])),
    });
    expect((await service.unpaidOrders(NOW)).items.map((i) => i.orderId)).toEqual(['k', 'n']);
  });

  it('judges a plan by the address the sweep would deliver to: the saved address it follows, when the same depot still serves it', async () => {
    // The snapshot is at the OK depot, the saved address moved a little (same depot): not held.
    const moved = { recipientName: 'A', phone: '08', addressLine: 'Baru', city: 'X', province: null, postalCode: null, notes: null, latitude: -6.51, longitude: 106.8 };
    const a = build({ active, saved: async () => moved, repo: { subscriptionsDueBetween: jest.fn().mockResolvedValue([sub('follow', -6.5, { addressId: 'ad1' })]) } });
    expect((await a.service.subscriptionsDue(NOW, NOW)).items.map((i) => i.id)).toEqual(['follow']);
    expect(a.customers.addressById).toHaveBeenCalledWith('c', 'ad1');
    // A saved address in ANOTHER depot's area is not followed (the sweep keeps the snapshot), so the
    // plan stays judged by its snapshot: at the held depot, left out.
    const far = { ...moved, latitude: -6.2 };
    const b = build({ active, saved: async () => far, repo: { subscriptionsDueBetween: jest.fn().mockResolvedValue([sub('held-snap', -6.2, { addressId: 'ad2' })]) } });
    expect((await b.service.subscriptionsDue(NOW, NOW)).items).toEqual([]);
    const c = build({ active, saved: async () => ({ ...moved, latitude: -6.2 }), repo: { subscriptionsDueBetween: jest.fn().mockResolvedValue([sub('would-move', -6.5, { addressId: 'ad3' })]) } });
    // snapshot at the OK depot, saved at the held depot: the sweep does not follow across depots, stays OK.
    expect((await c.service.subscriptionsDue(NOW, NOW)).items.map((i) => i.id)).toEqual(['would-move']);
  });

  it('an empty answer stays an empty answer when depot-service is down', async () => {
    const { service } = build({ active: async () => null });
    await expect(service.subscriptionsDue(NOW, NOW)).resolves.toEqual({ items: [], truncated: false });
    await expect(service.unpaidOrders(NOW)).resolves.toEqual({ items: [], truncated: false });
  });

  it('answers 503 rather than guess when the depots cannot be read', async () => {
    const o = (id: string) => ({ id, customerId: 'c', orderNumber: id, total: 1, depotId: null });
    const { service } = build({
      active: async () => null,
      repo: { subscriptionsDueBetween: jest.fn().mockResolvedValue([sub('a', -6.5)]), createdOrdersBetween: jest.fn().mockResolvedValue([o('a')]) },
      payments: async () => new Map([['a', { orderId: 'a', method: 'QRIS', status: 'PENDING' } as OrderPaymentRow]]),
    });
    await expect(service.subscriptionsDue(NOW, NOW)).rejects.toThrow('could not be read');
    await expect(service.unpaidOrders(NOW)).rejects.toThrow('could not be read');
  });
});

describe('abandonSweepEligible (HD-18)', () => {
  it('is the one predicate: subscriptions out, booked slots protected until they pass', () => {
    const before = new Date('2026-11-25T09:00:00Z');
    expect(abandonSweepEligible(before)).toEqual({ subscriptionId: null, OR: [{ scheduledFor: null }, { scheduledFor: { lt: before } }] });
    expect(abandonSweepEligible(before, false)).toEqual({ OR: [{ scheduledFor: null }, { scheduledFor: { lt: before } }] });
  });
});

describe('OrderAuditSink (HD-18)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  it('writes to auth-service under an order. action, fail-open for record and closed for recordOrThrow', async () => {
    const f = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = f as never;
    const sink = new OrderAuditSink({ authServiceUrl: 'http://auth:3001', internalServiceKey: 'k' } as OrderConfigService);
    const event = { action: 'machine.orders.by-phone.created', actorId: 'n8n', target: undefined, success: true, metadata: { msisdn: '[redacted]' } };
    await sink.record(event as never);
    await sink.recordOrThrow(event as never);
    expect(f).toHaveBeenCalledTimes(2);
    expect(JSON.parse(f.mock.calls[0][1].body).action).toBe('order.machine.orders.by-phone.created');
    f.mockResolvedValue({ ok: false, status: 500 });
    await expect(sink.recordOrThrow(event as never)).rejects.toBeDefined();
    await expect(sink.record(event as never)).resolves.toBeUndefined();
  });
});
