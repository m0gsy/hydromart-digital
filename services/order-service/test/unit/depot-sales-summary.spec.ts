import { OrderPrismaRepository } from '../../src/infrastructure/prisma/order.prisma.repository';
import { ReportService } from '../../src/application/services/report.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { InMemoryOrderRepository } from '../support/fakes';

/*
 * HD-6 H2: per-depot sales for the AI read API. Live orders only, no top-N cap, and a window of
 * instants: an order at 23:30 WIB on the last day is in, one at 00:10 WIB on the next is out.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const range = { from: new Date('2026-10-31T17:00:00.000Z'), to: new Date('2026-11-30T17:00:00.000Z') };

describe('OrderPrismaRepository.depotSalesSummary', () => {
  const group = (rows: { sales: unknown[]; statuses: unknown[] }) => {
    const groupBy = jest.fn().mockResolvedValueOnce(rows.sales).mockResolvedValueOnce(rows.statuses);
    return { groupBy, repo: new OrderPrismaRepository({ order: { groupBy } } as unknown as PrismaService) };
  };
  const dec = (n: number) => ({ toNumber: () => n });

  it('reads nothing for an empty depot list', async () => {
    const { groupBy, repo } = group({ sales: [], statuses: [] });
    await expect(repo.depotSalesSummary(range, [])).resolves.toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('folds the channel, the shipping and the status counts into one row per depot', async () => {
    const { groupBy, repo } = group({
      sales: [
        { depotId: D1, isWalkIn: false, _count: { _all: 2 }, _sum: { total: dec(300), deliveryFee: dec(20) } },
        { depotId: D1, isWalkIn: true, _count: { _all: 1 }, _sum: { total: dec(50), deliveryFee: null } },
        { depotId: D2, isWalkIn: false, _count: { _all: 1 }, _sum: { total: null, deliveryFee: null } },
      ],
      statuses: [
        { depotId: D1, status: 'CANCELLED', _count: { _all: 4 } },
        { depotId: D1, status: 'DELIVERED', _count: { _all: 1 } },
        { depotId: D1, status: 'COMPLETED', _count: { _all: 2 } },
        { depotId: D1, status: 'VOIDED', _count: { _all: 5 } },
        { depotId: D2, status: 'CREATED', _count: { _all: 1 } },
      ],
    });
    const rows = await repo.depotSalesSummary(range, [D1, D2]);
    expect(rows.find((r) => r.depotId === D1)).toEqual({
      depotId: D1,
      orders: 3,
      revenueIdr: 350,
      shippingIdr: 20,
      appOrders: 2,
      appRevenueIdr: 300,
      counterOrders: 1,
      counterRevenueIdr: 50,
      cancelledOrders: 4,
      deliveredOrders: 3,
    });
    expect(rows.find((r) => r.depotId === D2)).toMatchObject({ orders: 1, revenueIdr: 0, deliveredOrders: 0 });
    // sales exclude cancelled and voided; the status read does not, and both use the instants
    const [salesCall, statusCall] = groupBy.mock.calls.map((c) => c[0].where);
    expect(salesCall.status).toEqual({ notIn: ['CANCELLED', 'VOIDED'] });
    expect(salesCall.createdAt).toEqual({ gte: range.from, lt: range.to });
    expect(statusCall.status).toBeUndefined();
    expect(statusCall.createdAt).toEqual({ gte: range.from, lt: range.to });
    expect(salesCall.depotId).toEqual({ in: [D1, D2] });
  });
});

describe('ReportService.depotSalesSummary (fake repository)', () => {
  it('counts a 23:30 WIB order on the last day and leaves out one just after midnight', async () => {
    const orders = new InMemoryOrderRepository();
    const row = (id: string, createdAt: string, extra: object) =>
      ({ id, depotId: D1, total: 100, deliveryFee: 10, isWalkIn: false, status: 'COMPLETED', createdAt: new Date(createdAt), ...extra }) as never;
    orders.rows.push(
      row('a', '2026-11-30T16:30:00.000Z', {}),
      row('b', '2026-11-30T17:10:00.000Z', {}),
      row('c', '2026-11-10T03:00:00.000Z', { status: 'CANCELLED' }),
      row('d', '2026-11-10T03:00:00.000Z', { depotId: D2 }),
    );
    const svc = new ReportService(orders, { businessTimeZone: 'Asia/Jakarta' } as never);
    const { items } = await svc.depotSalesSummary(range, [D1]);
    expect(items).toEqual([expect.objectContaining({ depotId: D1, orders: 1, revenueIdr: 100, shippingIdr: 10, cancelledOrders: 1, deliveredOrders: 1 })]);
  });
});

describe('ReportService full per-product and per-city reads (HD-6 H2)', () => {
  const range2 = { from: new Date('2026-10-31T17:00:00.000Z'), to: new Date('2026-11-30T17:00:00.000Z') };
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ productId: `p${i}`, productName: `P${i}`, orderCount: 1, revenue: 1 }));
  const svcWith = (orders: Record<string, unknown>) =>
    new ReportService(orders as never, { businessTimeZone: 'Asia/Jakarta' } as never);

  it('asks for one row more than the cap and answers every product, past the top-N a report would cut at', async () => {
    const revenueByProduct = jest.fn().mockResolvedValue(items(150));
    await expect(svcWith({ revenueByProduct }).productRevenueAll(range2, [D1])).resolves.toEqual({ items: items(150) });
    expect(revenueByProduct).toHaveBeenCalledWith(range2, 2001, [D1]);
  });

  it('refuses, rather than cuts, past 2000 products or cities', async () => {
    await expect(svcWith({ revenueByProduct: async () => items(2001) }).productRevenueAll(range2, [D1])).rejects.toThrow('Terlalu banyak produk');
    const areas = Array.from({ length: 2001 }, (_, i) => ({ area: `K${i}`, orders: 1, revenue: 1 }));
    await expect(svcWith({ timeArea: async () => ({ heat: [], areas }) }).timeAreaAll(range2, [D1])).rejects.toThrow('Terlalu banyak kota');
  });

  it('gives every city, not the top ten', async () => {
    const areas = Array.from({ length: 25 }, (_, i) => ({ area: `K${i}`, orders: 25 - i, revenue: 1 }));
    const report = await svcWith({ timeArea: async () => ({ heat: [{ weekday: 1, hour: 3, orders: 2, revenue: 5 }], areas }) }).timeAreaAll(range2, [D1]);
    expect(report.byArea).toHaveLength(25);
    expect(report.otherAreas).toBeNull();
    expect(report.heat[0][3]).toBe(2);
  });
});
