import { randomUUID } from 'node:crypto';

import { ReportService } from '../../src/application/services/report.service';
import { CreateOrderData } from '../../src/application/ports/order.repository';
import { ANONYMOUS_CUSTOMER_ID } from '../../src/domain/anonymous';
import { OrderStatus } from '../../src/domain/order-status';
import { OrderConfigService } from '../../src/config/order-config.service';
import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { InMemoryOrderRepository } from '../support/fakes';

const config = { businessTimeZone: 'Asia/Jakarta' } as OrderConfigService;
const CUST_A = randomUUID();
const CUST_B = randomUUID();
const DEPOT_A = randomUUID();

function data(over: Partial<CreateOrderData>): CreateOrderData {
  return {
    orderNumber: `HM-${randomUUID().slice(0, 8)}`,
    trackingToken: randomUUID(),
    customerId: CUST_A,
    depotId: DEPOT_A,
    subtotal: 10000,
    deliveryFee: 0,
    discount: 0,
    total: 10000,
    recipientName: 'x',
    phone: 'x',
    addressLine: 'x',
    city: 'x',
    province: 'x',
    postalCode: null,
    latitude: null,
    longitude: null,
    notes: null,
    items: [],
    ...over,
  };
}

describe('ReportService.reportTable', () => {
  it('ORDERS_DETAIL: one row per order, named depot, cash from payment-service, anonymous labelled', async () => {
    const repo = new InMemoryOrderRepository();
    const delivery = await repo.create(data({ subtotal: 12000, deliveryFee: 3000, total: 15000 }));
    const counter = await repo.create(data({ customerId: ANONYMOUS_CUSTOMER_ID, depotId: null }));
    repo.rows.find((r) => r.id === counter.id)!.isWalkIn = true;
    const svc = new ReportService(
      repo,
      config,
      { listContacts: async () => [{ id: DEPOT_A, name: 'Depot A', contactPhone: null }] } as never,
      undefined,
      { cashByOrder: async () => [{ orderId: delivery.id, amountIdr: 15000 }] } as never,
    );

    const t = await svc.reportTable('ORDERS_DETAIL', {});

    expect(t.truncated).toBe(false);
    expect(t.columns.map((c) => c.key)).toEqual([
      'orderNumber',
      'createdAt',
      'status',
      'channel',
      'depot',
      'customer',
      'courier',
      'cashPaid',
      'subtotal',
      'discount',
      'deliveryFee',
      'total',
    ]);
    expect(t.rows.every((r) => r.length === t.columns.length)).toBe(true);
    const d = t.rows.find((r) => r[0] === delivery.orderNumber)!;
    expect(d.slice(3)).toEqual(['Antar', 'Depot A', CUST_A, null, 15000, 12000, 0, 3000, 15000]);
    const c = t.rows.find((r) => r[0] === counter.orderNumber)!;
    expect(c.slice(3, 8)).toEqual(['Kasir', null, 'Walk-in', null, 0]);
  });

  it('ORDERS_DETAIL: cash is null (not 0) when payment-service cannot answer, and falls back to the depot id', async () => {
    const repo = new InMemoryOrderRepository();
    await repo.create(data({}));
    const svc = new ReportService(repo, config, undefined, undefined, {
      cashByOrder: async () => null,
    } as never);
    const t = await svc.reportTable('ORDERS_DETAIL', {});
    expect(t.rows[0][7]).toBeNull();
    expect(t.rows[0][4]).toBe(DEPOT_A);
    // No cash port at all is the same "unknown".
    const bare = await new ReportService(repo, config).reportTable('ORDERS_DETAIL', {});
    expect(bare.rows[0][7]).toBeNull();
  });

  it('ORDERS_DETAIL: asks payment-service in batches and flags a cut-off table', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      id: `o${i}`,
      orderNumber: `N${i}`,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      status: OrderStatus.CREATED,
      depotId: null,
      customerId: CUST_A,
      driverName: 'Budi',
      isWalkIn: false,
      subtotal: 1,
      discount: 0,
      deliveryFee: 0,
      total: 1,
    }));
    const ordersForTable = jest.fn(async () => rows);
    const cashByOrder = jest.fn(async () => []);
    const svc = new ReportService({ ordersForTable } as never, config, undefined, undefined, {
      cashByOrder,
    } as never);

    const t = await svc.reportTable('ORDERS_DETAIL', {});

    expect(ordersForTable).toHaveBeenCalledWith({}, 5001);
    expect(t.rows).toHaveLength(5000);
    expect(t.truncated).toBe(true);
    expect(cashByOrder).toHaveBeenCalledTimes(10);
    expect(t.rows[0][6]).toBe('Budi');
  });

  it('NEW_VS_REPEAT: counts first-ever buyers inside the window as new, the rest as repeat', async () => {
    const repo = new InMemoryOrderRepository();
    const before = await repo.create(data({ customerId: CUST_B }));
    repo.rows.find((r) => r.id === before.id)!.createdAt = new Date('2026-09-01T00:00:00Z');
    const inWin = new Date('2026-10-10T00:00:00Z');
    for (const customerId of [CUST_A, CUST_B]) {
      const o = await repo.create(data({ customerId, total: 20000 }));
      repo.rows.find((r) => r.id === o.id)!.createdAt = inWin;
    }
    const svc = new ReportService(
      repo,
      config,
      { listContacts: async () => [{ id: DEPOT_A, name: 'Depot A', contactPhone: null }] } as never,
    );

    const t = await svc.reportTable('NEW_VS_REPEAT', {
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-11-01T00:00:00Z'),
    });

    expect(t.columns.map((c) => c.type)).toEqual(['text', 'int', 'int', 'int', 'money', 'percent']);
    expect(t.rows).toEqual([['Depot A', 1, 1, 2, 40000, 50]]);
    expect(t.truncated).toBe(false);
  });

  it('NEW_VS_REPEAT: no buyers gives 0%, an unbounded window makes everyone new, and the cap is reported', async () => {
    const repo = new InMemoryOrderRepository();
    await repo.create(data({}));
    const all = await new ReportService(repo, config).reportTable('NEW_VS_REPEAT', {});
    expect(all.rows[0].slice(1, 3)).toEqual([1, 0]);

    const rows = Array.from({ length: 5001 }, (_, i) => ({
      depotId: `d${i}`,
      newCustomers: 0,
      repeatCustomers: 0,
      orders: 0,
      revenue: 0,
    }));
    const capped = await new ReportService(
      { newVsRepeatByDepot: async () => rows } as never,
      config,
    ).reportTable('NEW_VS_REPEAT', {});
    expect(capped.rows).toHaveLength(5000);
    expect(capped.rows[0][5]).toBe(0);
    expect(capped.truncated).toBe(true);
  });
});

describe('OrderPrismaRepository report-table reads', () => {
  const dec = (n: number) => ({ toNumber: () => n });
  const order = { findMany: jest.fn() };
  const $queryRaw = jest.fn();
  const repo = new OrderPrismaRepository({ order, $queryRaw } as unknown as PrismaService);
  beforeEach(() => jest.clearAllMocks());

  it('ordersForTable: a bounded, ordered narrow read with Decimals turned into numbers', async () => {
    const from = new Date('2026-10-01');
    const to = new Date('2026-11-01');
    order.findMany.mockResolvedValue([
      { id: 'o1', status: 'CREATED', subtotal: dec(1), discount: dec(2), deliveryFee: dec(3), total: dec(4) },
    ]);

    const rows = await repo.ordersForTable({ from, to }, 5001);

    const arg = order.findMany.mock.calls[0][0];
    expect(arg.take).toBe(5001);
    expect(arg.where).toEqual({ createdAt: { gte: from, lt: to } });
    expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(rows).toEqual([
      { id: 'o1', status: 'CREATED', subtotal: 1, discount: 2, deliveryFee: 3, total: 4 },
    ]);

    await repo.ordersForTable({}, 10);
    expect(order.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('newVsRepeatByDepot: bounded query, bigint/decimal counts become numbers', async () => {
    $queryRaw.mockResolvedValue([
      { depotId: 'd1', newCustomers: BigInt(2), repeatCustomers: BigInt(1), orders: BigInt(5), revenue: 123456 },
      { depotId: 'd2', newCustomers: BigInt(0), repeatCustomers: BigInt(0), orders: BigInt(0), revenue: null },
    ]);

    const out = await repo.newVsRepeatByDepot({ from: new Date('2026-10-01'), to: new Date('2026-11-01') }, 101);

    expect(out).toEqual([
      { depotId: 'd1', newCustomers: 2, repeatCustomers: 1, orders: 5, revenue: 123456 },
      { depotId: 'd2', newCustomers: 0, repeatCustomers: 0, orders: 0, revenue: 0 },
    ]);
    const sql = $queryRaw.mock.calls[0][0];
    expect(sql.sql).toMatch(/LIMIT \?/);
    expect(sql.values).toContain(101);
  });

  it('newVsRepeatByDepot: an unbounded window treats everyone as new', async () => {
    $queryRaw.mockResolvedValue([]);
    await expect(repo.newVsRepeatByDepot({}, 5)).resolves.toEqual([]);
    expect($queryRaw.mock.calls[0][0].sql).toContain('TRUE');
  });
});
