import { randomUUID } from 'node:crypto';

import { ReportService } from '../../src/application/services/report.service';
import { OrderStatus } from '../../src/domain/order-status';
import { CreateOrderData } from '../../src/application/ports/order.repository';
import { InMemoryOrderRepository } from '../support/fakes';

const CUST_A = randomUUID();
const CUST_B = randomUUID();
const DEPOT_A = randomUUID();
const DEPOT_B = randomUUID();

function orderData(over: Partial<CreateOrderData>): CreateOrderData {
  return {
    orderNumber: `HM-${randomUUID().slice(0, 8)}`,
    customerId: over.customerId ?? CUST_A,
    depotId: over.depotId ?? null,
    subtotal: over.total ?? 10000,
    deliveryFee: 0,
    discount: 0,
    total: over.total ?? 10000,
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
  };
}

describe('ReportService', () => {
  let repo: InMemoryOrderRepository;
  let reports: ReportService;

  beforeEach(async () => {
    repo = new InMemoryOrderRepository();
    reports = new ReportService(repo);
    await repo.create(orderData({ customerId: CUST_A, depotId: DEPOT_A, total: 50000 }));
    await repo.create(orderData({ customerId: CUST_A, depotId: DEPOT_A, total: 30000 }));
    await repo.create(orderData({ customerId: CUST_B, depotId: DEPOT_B, total: 20000 }));
    // A cancelled order must be excluded from every aggregate.
    const cancelled = await repo.create(
      orderData({ customerId: CUST_B, depotId: DEPOT_B, total: 999999 }),
    );
    await repo.applyStatus(cancelled.id, OrderStatus.CANCELLED, null, null);
    // An unrouted order counts for sales/customers but never for top-depots.
    await repo.create(orderData({ customerId: CUST_A, depotId: null, total: 5000 }));
  });

  it('ranks top customers by revenue, excluding cancelled orders', async () => {
    const { items } = await reports.topCustomers({}, 10);
    expect(items[0]).toMatchObject({ customerId: CUST_A, orderCount: 3, revenue: 85000 });
    expect(items[1]).toMatchObject({ customerId: CUST_B, orderCount: 1, revenue: 20000 });
  });

  it('ranks top depots by revenue, ignoring unrouted and cancelled orders', async () => {
    const { items } = await reports.topDepots({}, 10);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ depotId: DEPOT_A, orderCount: 2, revenue: 80000 });
    expect(items[1]).toMatchObject({ depotId: DEPOT_B, orderCount: 1, revenue: 20000 });
  });

  it('sums refunds per depot, INCLUDING cancelled orders (a cancel is what refunds)', async () => {
    // Refund a live DEPOT_A order and a cancelled DEPOT_B order; both must count.
    const live = await repo.create(orderData({ depotId: DEPOT_A, total: 40000 }));
    await repo.recordRefund(live.id, 40000);
    const cancelledRefunded = await repo.create(orderData({ depotId: DEPOT_B, total: 15000 }));
    await repo.applyStatus(cancelledRefunded.id, OrderStatus.CANCELLED, null, null);
    await repo.recordRefund(cancelledRefunded.id, 15000);

    const { items } = await reports.refundsByDepot({});
    const byDepot = Object.fromEntries(items.map((r) => [r.depotId, r.refunded]));
    expect(byDepot[DEPOT_A]).toBe(40000);
    expect(byDepot[DEPOT_B]).toBe(15000); // cancelled order's refund still counted
  });

  it('respects the limit', async () => {
    const { items } = await reports.topCustomers({}, 1);
    expect(items).toHaveLength(1);
    expect(items[0].customerId).toBe(CUST_A);
  });

  it('buckets sales and sums non-cancelled revenue', async () => {
    const report = await reports.sales('monthly', {});
    const totalRevenue = report.buckets.reduce((s, b) => s + b.revenue, 0);
    const totalOrders = report.buckets.reduce((s, b) => s + b.orderCount, 0);
    expect(totalRevenue).toBe(105000); // 50k+30k+20k+5k, cancelled 999999 excluded
    expect(totalOrders).toBe(4);
  });

  it('summarizes a customer lifetime, excluding cancelled from the totals', async () => {
    const summary = await reports.customerSummary(CUST_B);
    // Lifetime aggregate excludes the 999999 cancelled order: only the 20k counts.
    expect(summary.orderCount).toBe(1);
    expect(summary.revenue).toBe(20000);
    // Recent-orders list is the raw order history (cancellations are still shown).
    expect(summary.recentOrders.length).toBe(2);
    expect(summary.recentOrders[0].orderNumber).toBeTruthy();
    expect(summary.firstOrderAt).not.toBeNull();
    expect(summary.lastOrderAt).not.toBeNull();
  });

  it('groups revenue by product with a share summing to 1', async () => {
    const p1 = randomUUID();
    const p2 = randomUUID();
    const withItems = (over: Partial<CreateOrderData>, items: CreateOrderData['items']) => ({
      ...orderData(over),
      items,
    });
    const r2 = new InMemoryOrderRepository();
    const svc = new ReportService(r2);
    await r2.create(
      withItems({ total: 60000 }, [
        {
          productId: p1,
          productName: 'Galon 19L',
          sku: 'G19',
          unit: 'Galon',
          volumeMl: 19000,
          isGallon: true,
          unitPrice: 20000,
          quantity: 2,
          lineTotal: 40000,
        },
        {
          productId: p2,
          productName: 'Air 600ml',
          sku: 'A600',
          unit: 'Dus',
          volumeMl: null,
          isGallon: false,
          unitPrice: 20000,
          quantity: 1,
          lineTotal: 20000,
        },
      ]),
    );
    const report = await svc.revenueByProduct({}, 10);
    expect(report.grouping).toBe('product');
    expect(report.items[0]).toMatchObject({ productId: p1, revenue: 40000 });
    const shareSum = report.items.reduce((s, i) => s + i.share, 0);
    expect(shareSum).toBeCloseTo(1, 5);
  });

  it('pivots retention into per-cohort rows (M0 = 100%)', async () => {
    const report = await reports.retentionCohort({});
    expect(report.rows.length).toBeGreaterThan(0);
    // Every cohort's own month retains 100% of itself.
    expect(report.rows.every((r) => r.cells[0] === 1)).toBe(true);
  });

  it('counts distinct reachable customers, excluding cancelled', async () => {
    // CUST_A + CUST_B have non-cancelled orders; the 999999 cancelled order is CUST_B too.
    const all = await reports.audienceReach();
    expect(all.count).toBe(2);
    expect(all.depotId).toBeNull();
  });

  it('scopes audience reach to one depot', async () => {
    const a = await reports.audienceReach(DEPOT_A);
    expect(a).toEqual({ depotId: DEPOT_A, count: 1 }); // only CUST_A ordered at DEPOT_A
  });

  it('sizes a frequency segment (>= N orders), excluding cancelled', async () => {
    // CUST_A has 3 non-cancelled orders, CUST_B has 1 (cancelled excluded).
    const two = await reports.segmentEstimate({ minOrders: 2 });
    expect(two.count).toBe(1);
    expect(two.minOrders).toBe(2);
    const one = await reports.segmentEstimate({ minOrders: 1 });
    expect(one.count).toBe(2);
  });

  it('sizes a recency segment (last order within N days)', async () => {
    // All seed orders were just created, so a wide recency window keeps everyone.
    const recent = await reports.segmentEstimate({ recencyDays: 30 });
    expect(recent.count).toBe(2);
    expect(recent.recencyDays).toBe(30);
  });

  it('scopes a segment to a depot', async () => {
    const atA = await reports.segmentEstimate({ depotId: DEPOT_A });
    expect(atA.count).toBe(1); // only CUST_A ordered at DEPOT_A
    expect(atA.depotId).toBe(DEPOT_A);
  });

  it('sizes an at-risk segment (last order older than N days)', async () => {
    // Seed orders were just created, so nobody is lapsed against any positive window.
    const lapsed = await reports.segmentEstimate({ lapsedDays: 1 });
    expect(lapsed.count).toBe(0);
  });

  it('sizes a new-customer segment (first order within N days)', async () => {
    // Everyone's first order is recent → both reachable customers qualify.
    const fresh = await reports.segmentEstimate({ newWithinDays: 30 });
    expect(fresh.count).toBe(2);
  });

  it('composes a depot daily report: real orders/revenue/gallons, cancelled = failed', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r);
    const depot = randomUUID();
    const day = '2026-07-15';
    const at = (h: number) => new Date(`${day}T0${h}:00:00.000Z`);
    const gallon = [
      {
        productId: randomUUID(),
        productName: 'Galon 19L',
        sku: 'G19',
        unit: 'Galon',
        volumeMl: 19000,
        isGallon: true,
        unitPrice: 20000,
        quantity: 3,
        lineTotal: 60000,
      },
    ];
    // Two delivered gallon orders + one cancelled (counts as a failed delivery, not revenue).
    const o1 = await r.create({ ...orderData({ depotId: depot, total: 60000 }), items: gallon });
    const o2 = await r.create({ ...orderData({ depotId: depot, total: 60000 }), items: gallon });
    const c1 = await r.create({ ...orderData({ depotId: depot, total: 99999 }), items: gallon });
    for (const o of [o1, o2]) {
      r.rows.find((x) => x.id === o.id)!.status = OrderStatus.DELIVERED;
      r.rows.find((x) => x.id === o.id)!.createdAt = at(1);
    }
    await r.applyStatus(c1.id, OrderStatus.CANCELLED, null, null);
    r.rows.find((x) => x.id === c1.id)!.createdAt = at(2);

    const rep = await svc.depotDaily(depot, day);
    expect(rep.orders).toBe(2); // cancelled excluded
    expect(rep.revenueIdr).toBe(120000);
    expect(rep.gallonsDelivered).toBe(6); // 3 + 3 on the two delivered orders
    expect(rep.failedDeliveries).toBe(1); // the cancelled order
    expect(rep.perCourier).toEqual([]); // TODO: delivery-service join
    expect(rep.codCollectedIdr).toBeNull(); // unwired: payment COD not joinable here
    expect(rep.gallonsReturned).toBeNull();
    expect(rep.gallonsDamaged).toBeNull();
  });

  // The export behind the button that used to do nothing. It must show the SAME day the
  // report shows, and it must carry cancelled orders — a file that drops them silently
  // cannot be reconciled against the till.
  it('exports the day order by order, cancelled rows included and flagged', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r);
    const depot = randomUUID();
    const day = '2026-07-15';
    const items = [
      {
        productId: randomUUID(),
        productName: 'Galon 19L',
        sku: 'G19',
        unit: 'Galon',
        volumeMl: 19000,
        isGallon: true,
        unitPrice: 20000,
        quantity: 2,
        lineTotal: 40000,
      },
    ];
    const kept = await r.create({ ...orderData({ depotId: depot, total: 40000 }), items });
    const gone = await r.create({ ...orderData({ depotId: depot, total: 40000 }), items });
    const yesterday = await r.create({ ...orderData({ depotId: depot, total: 40000 }), items });
    r.rows.find((x) => x.id === kept.id)!.createdAt = new Date(`${day}T01:00:00.000Z`);
    r.rows.find((x) => x.id === gone.id)!.createdAt = new Date(`${day}T02:00:00.000Z`);
    r.rows.find((x) => x.id === yesterday.id)!.createdAt = new Date('2026-07-14T23:00:00.000Z');
    await r.applyStatus(gone.id, OrderStatus.CANCELLED, null, null);

    const rows = await svc.depotDailyRows(depot, day);

    expect(rows.map((x) => x.orderNumber)).toEqual([kept.orderNumber, gone.orderNumber]);
    expect(rows[1]).toMatchObject({ cancelled: true, gallons: 2, totalIdr: 40000 });
    expect(rows[0]).toMatchObject({ cancelled: false, recipientName: kept.recipientName });
  });

  it('composes a depot weekly report: revenueByDay, topProducts and a driverName topCourier', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r);
    const depot = randomUUID();
    const from = new Date('2026-07-10T00:00:00.000Z');
    const to = new Date('2026-07-17T00:00:00.000Z');
    const mk = async (dayIso: string, total: number, qty: number, driver: string | null) => {
      const o = await r.create({
        ...orderData({ depotId: depot, total }),
        items: [
          {
            productId: randomUUID(),
            productName: 'Galon 19L',
            sku: 'G19',
            unit: 'Galon',
            volumeMl: 19000,
            isGallon: true,
            unitPrice: 20000,
            quantity: qty,
            lineTotal: total,
          },
        ],
      });
      const row = r.rows.find((x) => x.id === o.id)!;
      row.createdAt = new Date(dayIso);
      row.status = OrderStatus.DELIVERED;
      row.driverName = driver;
    };
    await mk('2026-07-11T02:00:00.000Z', 40000, 2, 'Budi');
    await mk('2026-07-11T05:00:00.000Z', 20000, 1, 'Budi');
    await mk('2026-07-13T05:00:00.000Z', 30000, 1, 'Sari');

    const rep = await svc.depotWeekly(depot, from, to);
    expect(rep.orders).toBe(3);
    expect(rep.revenueIdr).toBe(90000);
    expect(rep.avgPerDayIdr).toBe(Math.round(90000 / 7));
    expect(rep.revenueByDay).toEqual([
      { day: '2026-07-11', revenueIdr: 60000 },
      { day: '2026-07-13', revenueIdr: 30000 },
    ]);
    expect(rep.topProducts[0]).toEqual({ label: 'Galon 19L', qty: 4 });
    expect(rep.topCourier).toEqual({ name: 'Budi', delivered: 2 }); // most deliveries
    expect(rep.slaOnTimePct).toBeUndefined();
  });

  it('compares depots: real orders/revenue, zeroes for empty depots, cancelled excluded', async () => {
    const empty = randomUUID();
    const cmp = await reports.reportsDepotCompare([DEPOT_A, DEPOT_B, empty], {});
    const byId = Object.fromEntries(cmp.depots.map((d) => [d.depotId, d]));
    expect(byId[DEPOT_A]).toMatchObject({ orders: 2, revenueIdr: 80000 });
    expect(byId[DEPOT_B]).toMatchObject({ orders: 1, revenueIdr: 20000 }); // 999999 cancelled excluded
    expect(byId[empty]).toMatchObject({ orders: 0, revenueIdr: 0 }); // requested depot with no orders
  });

  it('aggregates depot ratings: average, star distribution, and recent review cards', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r);
    const depot = randomUUID();
    const other = randomUUID();
    const review = async (depotId: string, rating: number, comment: string | null) => {
      const o = await r.create(orderData({ depotId }));
      await r.createReview({
        orderId: o.id,
        customerId: o.customerId,
        rating,
        aspects: [],
        comment,
        tipAmount: 0,
      });
    };
    await review(depot, 5, 'Mantap!');
    await review(depot, 5, 'Cepat');
    await review(depot, 4, null);
    await review(depot, 2, 'Galon bocor');
    await review(other, 1, 'not this depot'); // different depot, excluded

    const rep = await svc.depotRatings(depot, {});

    expect(rep.count).toBe(4);
    expect(rep.average).toBe(4); // (5+5+4+2)/4
    expect(rep.distribution).toEqual({ '1': 0, '2': 1, '3': 0, '4': 1, '5': 2 });
    // Recent is newest-first; the last review seeded (2★) leads.
    expect(rep.recent).toHaveLength(4);
    expect(rep.recent[0]).toMatchObject({ stars: 2, comment: 'Galon bocor' });
    expect(rep.recent[0].customerName).toBe('x');
  });

  it('returns a null average and zeroed distribution for a depot with no reviews', async () => {
    const rep = await reports.depotRatings(randomUUID(), {});
    expect(rep.average).toBeNull();
    expect(rep.count).toBe(0);
    expect(rep.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
    expect(rep.recent).toEqual([]);
  });

  it('composes a depot monthly review: real orders/revenue/activeCustomers, null sla/profit', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r);
    const depot = randomUUID();
    const custX = randomUUID();
    const custY = randomUUID();
    const mk = async (
      customerId: string,
      total: number,
      driver: string | null,
      status: OrderStatus,
    ) => {
      const o = await r.create(orderData({ depotId: depot, customerId, total }));
      const row = r.rows.find((x) => x.id === o.id)!;
      row.createdAt = new Date('2026-05-10T00:00:00.000Z');
      row.status = status;
      row.driverName = driver;
    };
    await mk(custX, 50000, 'Budi', OrderStatus.DELIVERED);
    await mk(custX, 30000, 'Budi', OrderStatus.DELIVERED);
    await mk(custY, 20000, 'Sari', OrderStatus.COMPLETED);
    // A cancelled in-month order and a live out-of-month order must both be excluded.
    const cancelled = await r.create(
      orderData({ depotId: depot, customerId: custY, total: 99999 }),
    );
    r.rows.find((x) => x.id === cancelled.id)!.createdAt = new Date('2026-05-11T00:00:00.000Z');
    await r.applyStatus(cancelled.id, OrderStatus.CANCELLED, null, null);
    const other = await r.create(orderData({ depotId: depot, customerId: custX, total: 70000 }));
    r.rows.find((x) => x.id === other.id)!.createdAt = new Date('2026-06-02T00:00:00.000Z');

    const rep = await svc.reportsDepotMonthly(depot, '2026-05');
    expect(rep.orders).toBe(3);
    expect(rep.revenueIdr).toBe(100000);
    expect(rep.activeCustomers).toBe(2); // distinct non-cancelled customers
    expect(rep.topCourier).toEqual({ name: 'Budi', delivered: 2 });
    expect(rep.netProfitIdr).toBeNull();
    expect(rep.slaPct).toBeNull();
  });

  it('sums shipping billed per depot, ignoring unrouted orders', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r);
    const depot = randomUUID();
    await r.create({ ...orderData({ depotId: depot, total: 10000 }), deliveryFee: 5000 });
    await r.create({ ...orderData({ depotId: depot, total: 10000 }), deliveryFee: 7000 });
    await r.create({ ...orderData({ depotId: null, total: 10000 }), deliveryFee: 9000 }); // unrouted, excluded

    const { items } = await svc.shippingByDepot({});
    expect(items).toEqual([{ depotId: depot, shippingBilled: 12000 }]);
  });

  it('averages ratings per depot from real reviews', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r);
    const depot = randomUUID();
    const review = async (rating: number) => {
      const o = await r.create(orderData({ depotId: depot }));
      await r.createReview({
        orderId: o.id,
        customerId: o.customerId,
        rating,
        aspects: [],
        comment: null,
        tipAmount: 0,
      });
    };
    await review(5);
    await review(3);

    const { items } = await svc.ratingByDepot({});
    expect(items).toEqual([{ depotId: depot, rating: 4, reviewCount: 2 }]);
  });
});

// The report surface degrades instead of dividing by zero or reading a missing row: these are
// the empty/absent shapes a real depot hits on a quiet week, driven off a stubbed repository
// so the exact aggregate rows can be dictated.
describe('ReportService empty and absent shapes', () => {
  const stub = (over: Record<string, unknown>): ReportService => new ReportService(over as never);

  it('gives every product a zero share when nothing sold', async () => {
    const svc = stub({
      revenueByProduct: async () => [{ productId: 'p1', productName: 'Galon', qty: 0, revenue: 0 }],
    });
    const out = await svc.revenueByProduct({}, 10);
    expect(out.items[0].share).toBe(0);
  });

  it('echoes both range bounds when the caller supplies them', async () => {
    const from = new Date('2026-05-01T00:00:00.000Z');
    const to = new Date('2026-06-01T00:00:00.000Z');
    const svc = stub({ revenueByProduct: async () => [] });
    const out = await svc.revenueByProduct({ from, to }, 10);
    expect(out).toMatchObject({ from: from.toISOString(), to: to.toISOString() });
  });

  it('reports a cohort that never had a month-0 as zero-sized, not NaN', async () => {
    const svc = stub({
      retentionCohort: async () => [
        { cohort: '2026-01', monthIndex: 0, customers: 10 },
        { cohort: '2026-01', monthIndex: 1, customers: 4 },
        { cohort: '2026-02', monthIndex: 1, customers: 3 }, // no month-0 row
      ],
    });
    const out = await svc.retentionCohort({});
    expect(out.rows[0]).toMatchObject({ label: '2026-01', cohortSize: 10, cells: [1, 0.4] });
    expect(out.rows[1]).toMatchObject({ label: '2026-02', cohortSize: 0, cells: [0, 0] });
  });

  it('nulls a customer summary that has no orders at all', async () => {
    const svc = stub({
      customerLifetime: async () => ({
        orderCount: 0,
        revenue: 0,
        firstOrderAt: null,
        lastOrderAt: null,
      }),
      search: async () => ({ items: [], total: 0 }),
    });
    const out = await svc.customerSummary('c1');
    expect(out).toMatchObject({ firstOrderAt: null, lastOrderAt: null, recentOrders: [] });
  });

  it('defaults the weekly window to the last seven days and omits a courier nobody drove', async () => {
    const svc = stub({
      ordersForDepot: async () => [
        {
          id: 'o1',
          customerId: 'c1',
          status: OrderStatus.DELIVERED,
          total: 20000,
          driverName: null,
          createdAt: new Date(),
          items: [
            {
              productId: 'p1',
              productName: 'Galon 19L',
              unit: 'botol',
              volumeMl: null,
              isGallon: false,
              quantity: 2,
            },
            {
              productId: 'p2',
              productName: 'Tutup',
              unit: 'pcs',
              volumeMl: null,
              isGallon: false,
              quantity: 5,
            },
          ],
        },
      ],
    });
    const out = await svc.depotWeekly('d1');
    expect(out.topCourier).toBeUndefined();
    expect(out.topProducts.map((p) => p.label)).toEqual(['Tutup', 'Galon 19L']);
    expect(new Date(out.to).getTime() - new Date(out.from).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('omits the top courier from a month nobody delivered in', async () => {
    const svc = stub({ ordersForDepot: async () => [] });
    const out = await svc.reportsDepotMonthly('d1', '2026-05');
    expect(out.topCourier).toBeUndefined();
    expect(out.orders).toBe(0);
  });

  // Behaviour change, deliberate (migration 20260802120000_meter_reading): a gallon is
  // now whatever carries the snapshotted isGallon flag. A bottled line whose PRODUCT
  // NAME merely mentions "Galon" used to be counted as gallons sold by the old
  // /galon/i-over-name heuristic; it is not a gallon of water and no longer counts.
  it('zeroes a reseller who bought nothing, and does not count bottled lines as gallons', async () => {
    const bought = {
      id: 'o1',
      customerId: 'reseller-1',
      status: OrderStatus.DELIVERED,
      total: 90000,
      createdAt: new Date('2026-05-10T00:00:00.000Z'),
      items: [
        {
          productId: 'p1',
          productName: 'Galon 19L',
          unit: 'botol',
          volumeMl: null,
          isGallon: false,
          quantity: 3,
        },
        {
          productId: 'p2',
          productName: 'Tutup',
          unit: 'pcs',
          volumeMl: null,
          isGallon: false,
          quantity: 9,
        },
      ],
    };
    const svc = stub({ ordersForDepot: async () => [bought] });
    const out = await svc.resellerRollup('d1', '2026-05', ['reseller-1', 'reseller-2']);
    // The order still counts (orderCount 1) but contributes 0 gallons: neither line
    // is flagged isGallon, and "Galon 19L" sold by the botol is not a gallon.
    expect(out.rows[0]).toMatchObject({ customerId: 'reseller-1', volumeQty: 0, orderCount: 1 });
    expect(out.rows[1]).toMatchObject({
      customerId: 'reseller-2',
      volumeQty: 0,
      prevVolumeQty: 0,
      orderCount: 0,
      lastOrderAt: null,
    });
  });
});
