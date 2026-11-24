import { randomUUID } from 'node:crypto';

import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PaymentService } from '../../src/application/services/payment.service';
import { OrderCoordinationHttpAdapter } from '../../src/infrastructure/http/order-coordination.http.adapter';
import { DepotMoneyQueryDto } from '../../src/modules/dto/payment.dto';
import { PaymentPrismaRepository } from '../../src/infrastructure/prisma/payment.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PaymentMethod, PaymentStatus } from '../../src/domain/payment';
import { FakeGateway, FakeOrderCoordination, InMemoryPaymentRepository, buildTestConfig } from '../support/fakes';

/*
 * HD-6 H2: money by the depot of the ORDER. A counter payment names its drawer; a delivery
 * payment is placed through order-service. Windows are half-open instants, so a payment at
 * 23:30 WIB on the last day is in and one at 00:10 WIB the next day is out.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const from = new Date('2026-10-31T17:00:00.000Z');
const to = new Date('2026-11-30T17:00:00.000Z');

describe('PaymentService.moneyByDepot', () => {
  let repo: InMemoryPaymentRepository;
  let orders: FakeOrderCoordination;
  let service: PaymentService;

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    orders = new FakeOrderCoordination();
    service = new PaymentService(repo, new FakeGateway(), orders, buildTestConfig());
  });

  const add = (o: Record<string, unknown>) => {
    const row = {
      id: randomUUID(),
      orderId: randomUUID(),
      customerId: randomUUID(),
      method: PaymentMethod.CASH,
      status: PaymentStatus.PAID,
      amount: 100_000,
      refundedAmount: null,
      depotId: null,
      paidAt: new Date('2026-11-10T03:00:00.000Z'),
      createdAt: new Date('2026-11-10T03:00:00.000Z'),
      refundedAt: null,
      ...o,
    } as never as (typeof repo.rows)[number];
    repo.rows.push(row);
    return row;
  };

  it('collected: counter by its drawer, delivery by the order depot, part-refund at what stayed', async () => {
    const delivery = add({ amount: 50_000 });
    orders.orderDepots.set(delivery.orderId, D1);
    add({ depotId: D1, amount: 30_000, method: PaymentMethod.QRIS });
    add({ status: PaymentStatus.REFUNDED, amount: 40_000, refundedAmount: 15_000, depotId: D1 });
    // another depot, a window edge, and a fully refunded row stay out
    add({ depotId: D2 });
    add({ depotId: D1, paidAt: new Date('2026-11-30T17:10:00.000Z') });
    add({ depotId: D1, status: PaymentStatus.REFUNDED, amount: 9_000, refundedAmount: null });
    const { rows } = await service.moneyByDepot('collected', [D1], from, to);
    const sum = (channel: string, method: string) =>
      rows.filter((r) => r.channel === channel && r.method === method).reduce((s, r) => s + r.amountIdr, 0);
    expect(sum('delivery', 'CASH')).toBe(50_000);
    expect(sum('counter', 'QRIS')).toBe(30_000);
    expect(sum('counter', 'CASH')).toBe(25_000);
    expect(rows.every((r) => r.depotId === D1)).toBe(true);
  });

  it('collected: a delivery payment on an order with no depot, or in another depot, is left out', async () => {
    const none = add({});
    orders.depotlessOrders.add(none.orderId);
    const other = add({});
    orders.orderDepots.set(other.orderId, D2);
    expect((await service.moneyByDepot('collected', [D1], from, to)).rows).toEqual([]);
  });

  it('is 503, never counter-only numbers, when the order depots cannot be read in full', async () => {
    const delivery = add({ amount: 50_000 });
    orders.orderDepots.set(delivery.orderId, D1);
    add({ depotId: D1, amount: 30_000 });
    // down
    orders.strictFails = true;
    await expect(service.moneyByDepot('collected', [D1], from, to)).rejects.toBeInstanceOf(ServiceUnavailableException);
    // an order id order-service does not know (partial answer): the count is in the 503, the ids in the log
    orders.strictFails = false;
    const orphan = add({});
    const warn = jest.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation();
    await expect(service.moneyByDepot('collected', [D1], from, to)).rejects.toThrow('1 pesanan tidak dikenal');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(orphan.orderId));
    warn.mockRestore();
    // counter-only windows need no lookup at all
    repo.rows.length = 0;
    add({ depotId: D1, amount: 30_000 });
    orders.strictFails = true;
    expect((await service.moneyByDepot('collected', [D1], from, to)).rows).toHaveLength(1);
  });

  it('counts paid orders with no depot apart, in no depot number (N2)', async () => {
    const none = add({ amount: 40_000 });
    orders.depotlessOrders.add(none.orderId);
    const placed = add({ amount: 10_000 });
    orders.orderDepots.set(placed.orderId, D1);
    const out = await service.moneyByDepot('collected', [D1], from, to);
    expect(out.unplaced).toEqual({ orders: 1, amountIdr: 40_000 });
    expect(out.rows.reduce((s, r) => s + r.amountIdr, 0)).toBe(10_000);
    // none: unplaced is zero, not absent
    repo.rows.length = 0;
    expect((await service.moneyByDepot('collected', [D1], from, to)).unplaced).toEqual({ orders: 0, amountIdr: 0 });
  });

  it('reads counter payments only for the depots asked', async () => {
    add({ depotId: D1 });
    add({ depotId: D2 });
    const spy = jest.spyOn(repo, 'moneyByOrder');
    await service.moneyByDepot('collected', [D1], from, to);
    expect(spy.mock.calls[0][4]).toEqual([D1]);
  });

  it('pending: ages in WIB calendar days into the shared buckets', async () => {
    add({ status: PaymentStatus.PENDING, depotId: D1, amount: 10_000, createdAt: new Date() });
    add({
      status: PaymentStatus.PENDING,
      depotId: D1,
      amount: 20_000,
      createdAt: new Date(Date.now() - 10 * 86_400_000),
    });
    const wide = { from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const { rows } = await service.moneyByDepot('pending', [D1], wide.from, wide.to);
    expect(rows.map((r) => [r.age, r.amountIdr]).sort()).toEqual([
      ['0-1', 10_000],
      ['8+', 20_000],
    ]);
  });

  it('refunded: kept per order so the caller can set cancelled orders apart', async () => {
    const a = add({
      status: PaymentStatus.REFUNDED,
      depotId: D1,
      amount: 40_000,
      refundedAmount: 15_000,
      refundedAt: new Date('2026-11-20T03:00:00.000Z'),
    });
    add({
      status: PaymentStatus.REFUNDED,
      depotId: D1,
      amount: 7_000,
      refundedAmount: null,
      refundedAt: new Date('2026-12-02T03:00:00.000Z'),
    });
    const { rows } = await service.moneyByDepot('refunded', [D1], from, to);
    expect(rows).toEqual([expect.objectContaining({ depotId: D1, orderId: a.orderId, amountIdr: 15_000 })]);
  });

  it('refuses a window with more order rows than it can answer in full', async () => {
    jest.spyOn(repo, 'moneyByOrder').mockResolvedValue(
      Array.from({ length: 20_001 }, (_, i) => ({
        orderId: `o${i}`,
        counterDepotId: D1,
        method: PaymentMethod.CASH,
        bucket: 0,
        amountIdr: 1,
        count: 1,
      })),
    );
    await expect(service.moneyByDepot('collected', [D1], from, to)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('says in the 422 that the cap is network-wide for delivery payments', async () => {
    jest.spyOn(repo, 'moneyByOrder').mockResolvedValue(
      Array.from({ length: 20_001 }, (_, i) => ({ orderId: `o${i}`, counterDepotId: D1, method: PaymentMethod.CASH, bucket: 0, amountIdr: 1, count: 1 })),
    );
    await expect(service.moneyByDepot('collected', [D1], from, to)).rejects.toThrow('seluruh jaringan');
  });
});

describe('OrderCoordinationHttpAdapter.getOrderDepotsStrict', () => {
  const adapter = (url = 'http://order.test') =>
    new OrderCoordinationHttpAdapter({ orderServiceUrl: url, internalServiceKey: 'k' } as never);
  afterEach(() => jest.restoreAllMocks());
  const answer = (rowsFor: (ids: string[]) => unknown[], ok = true) =>
    jest.spyOn(global, 'fetch').mockImplementation(async (_u, init) => {
      const ids = JSON.parse(String(init?.body)).orderIds as string[];
      return { ok, status: ok ? 200 : 503, json: async () => rowsFor(ids) } as unknown as Response;
    });

  it('asks in batches of 500 and returns null for an order with no depot', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `o${i}`);
    const spy = answer((batch) => batch.map((orderId) => ({ orderId, depotId: orderId === 'o0' ? null : D1 })));
    const out = await adapter().getOrderDepotsStrict(ids);
    expect(spy.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).orderIds.length)).toEqual([500, 1]);
    expect(out.get('o0')).toBeNull();
    expect(out.get('o500')).toBe(D1);
    expect(out.size).toBe(501);
  });

  it('throws on a non-2xx, on an id left out of the answer, and when unwired', async () => {
    answer(() => [], false);
    await expect(adapter().getOrderDepotsStrict(['a'])).rejects.toThrow('503');
    answer(() => []);
    await expect(adapter().getOrderDepotsStrict(['a'])).rejects.toThrow('did not know 1');
    await expect(adapter('').getOrderDepotsStrict(['a'])).rejects.toThrow('not wired');
    answer(() => []);
    await expect(adapter().getOrderDepotsStrict([])).resolves.toEqual(new Map());
  });
});

describe('DepotMoneyQueryDto', () => {
  const check = async (o: object) =>
    validate(plainToInstance(DepotMoneyQueryDto, { kind: 'collected', depotIds: D1, ...o }));

  it('wants from before to, and a window of at most 400 days', async () => {
    expect(await check({ from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' })).toHaveLength(0);
    expect(await check({ from: '2026-11-30T17:00:00.000Z', to: '2026-10-31T17:00:00.000Z' })).not.toHaveLength(0);
    expect(await check({ from: '2025-01-01T00:00:00.000Z', to: '2026-11-30T17:00:00.000Z' })).not.toHaveLength(0);
  });
});

describe('PaymentPrismaRepository.moneyByOrder', () => {
  const window = { from, to };
  const aging = { asOf: new Date('2026-11-25T05:00:00.000Z'), tz: 'Asia/Jakarta', maxDays: [1, 3, 7] };
  const raw = (extra: object) => ({
    orderId: 'o1',
    counterDepotId: null,
    method: 'CASH',
    bucket: 0,
    amount: null,
    count: BigInt(0),
    ...extra,
  });

  it.each(['collected', 'pending', 'refunded'] as const)('%s: maps rows and bounds the read', async (kind) => {
    const q = jest.fn().mockResolvedValue([raw({ amount: '12500.4', count: BigInt(2), bucket: BigInt(1) }), raw({})]);
    const repo = new PaymentPrismaRepository({ $queryRaw: q } as unknown as PrismaService);
    const out = await repo.moneyByOrder(kind, window, 5, aging, [D1]);
    expect(out[0]).toMatchObject({ orderId: 'o1', method: PaymentMethod.CASH, amountIdr: 12500, count: 2, bucket: 1 });
    expect(out[1].amountIdr).toBe(0);
    const sql = q.mock.calls[0][0];
    expect(sql.sql).toContain('LIMIT');
    expect(sql.values).toContain(5);
    // the column stays bare so its index can be used; the parameter is the one converted
    expect(sql.sql).toMatch(/"(paidAt|createdAt|refundedAt)" >= \(\?::timestamptz AT TIME ZONE 'UTC'\)/);
    // counter payments only for the depots asked; delivery ones (no depot) network-wide
    expect(sql.sql).toContain('"depotId" IS NULL OR "depotId" = ANY(');
    expect(sql.values).toContain(D1);
    expect(sql.values).toEqual(expect.arrayContaining([window.from, window.to]));
    if (kind === 'refunded') expect(sql.sql).toContain('refundSettledAt');
    if (kind === 'pending') expect(sql.values).toEqual(expect.arrayContaining([1, 3, 7]));
  });
});
