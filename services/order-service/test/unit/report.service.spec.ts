import { randomUUID } from 'node:crypto';

import { ReportService } from '../../src/application/services/report.service';
import { OrderStatus } from '../../src/domain/order-status';
import { CreateOrderData } from '../../src/application/ports/order.repository';
import { InMemoryOrderRepository } from '../support/fakes';
import { OrderConfigService } from '../../src/config/order-config.service';
/**
 * The service reads only `businessTimeZone` off the config. WIB is pinned here on
 * purpose: every day/month boundary in these reports used to be built from UTC (H-16),
 * and a test that inherits the host's zone cannot catch that coming back.
 */
const reportTestConfig = (timeZone = 'Asia/Jakarta'): OrderConfigService =>
  ({ businessTimeZone: timeZone }) as OrderConfigService;


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
    reports = new ReportService(repo, reportTestConfig());
    await repo.create(orderData({ customerId: CUST_A, depotId: DEPOT_A, total: 50000 }));
    await repo.create(orderData({ customerId: CUST_A, depotId: DEPOT_A, total: 30000 }));
    await repo.create(orderData({ customerId: CUST_B, depotId: DEPOT_B, total: 20000 }));
    // A cancelled order must be excluded from every aggregate.
    const cancelled = await repo.create(
      orderData({ customerId: CUST_B, depotId: DEPOT_B, total: 999999 }),
    );
    await repo.applyStatus(cancelled.id, OrderStatus.CREATED, OrderStatus.CANCELLED, null, null);
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
    await repo.applyStatus(cancelledRefunded.id, OrderStatus.CREATED, OrderStatus.CANCELLED, null, null);
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
    const svc = new ReportService(r2, reportTestConfig());
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
    const svc = new ReportService(r, reportTestConfig());
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
    await r.applyStatus(c1.id, OrderStatus.CREATED, OrderStatus.CANCELLED, null, null);
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
    const svc = new ReportService(r, reportTestConfig());
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
    r.rows.find((x) => x.id === kept.id)!.createdAt = new Date('2026-07-14T17:00:00.000Z'); // 00:00 WIB
    r.rows.find((x) => x.id === gone.id)!.createdAt = new Date(`${day}T02:00:00.000Z`); // 09:00 WIB
    r.rows.find((x) => x.id === yesterday.id)!.createdAt = new Date('2026-07-14T16:59:00.000Z');
    await r.applyStatus(gone.id, OrderStatus.CREATED, OrderStatus.CANCELLED, null, null);

    const rows = await svc.depotDailyRows(depot, day);

    expect(rows.map((x) => x.orderNumber)).toEqual([kept.orderNumber, gone.orderNumber]);
    expect(rows[1]).toMatchObject({ cancelled: true, gallons: 2, totalIdr: 40000 });
    expect(rows[0]).toMatchObject({ cancelled: false, recipientName: kept.recipientName });
  });

  /*
   * K-2. The export's own doc said it "reads the exact window depotDaily reads" while
   * reading a UTC one. Both now come from the same private `dayWindow`, and this test is
   * what keeps them there: it asserts the file and the screen agree order-for-order,
   * including the two WIB edges, rather than asserting either window's shape.
   */
  it('exports exactly the orders the daily report counted, edges included', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r, reportTestConfig());
    const depot = randomUUID();
    const place = async (iso: string) => {
      const o = await r.create({ ...orderData({ depotId: depot, total: 50000 }) });
      const row = r.rows.find((x) => x.id === o.id)!;
      row.status = OrderStatus.DELIVERED;
      row.createdAt = new Date(iso);
    };
    await place('2026-07-14T17:00:00.000Z'); // 00:00 WIB on the 15th — in
    await place('2026-07-15T16:59:00.000Z'); // 23:59 WIB on the 15th — in
    await place('2026-07-14T16:59:00.000Z'); // 23:59 WIB on the 14th — out
    await place('2026-07-15T17:00:00.000Z'); // 00:00 WIB on the 16th — out

    const report = await svc.depotDaily(depot, '2026-07-15');
    const rows = await svc.depotDailyRows(depot, '2026-07-15');
    expect(rows).toHaveLength(report.orders);
    expect(rows.reduce((s, x) => s + x.totalIdr, 0)).toBe(report.revenueIdr);
  });

  it('defaults the export to the same WIB today the report defaults to', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T19:00:00Z')); // 02:00 WIB, 4 Aug
    try {
      const r = new InMemoryOrderRepository();
      const svc = new ReportService(r, reportTestConfig());
      const depot = randomUUID();
      const o = await r.create({ ...orderData({ depotId: depot, total: 50000 }) });
      r.rows.find((x) => x.id === o.id)!.createdAt = new Date('2026-08-03T19:30:00Z');

      expect((await svc.depotDaily(depot)).date).toBe('2026-08-04');
      // A UTC default would have asked for 2026-08-03 and returned nothing.
      expect(await svc.depotDailyRows(depot)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // H-16: the window used to be [date T00:00Z, +24h) — which is 07:00 WIB to 07:00 WIB.
  // An order at 01:00 WIB fell into the PREVIOUS day's report and one at 03:00 WIB the
  // next morning was counted as today's, so the depot's daily revenue was wrong twice
  // over. Both edges are asserted, because fixing only one just moves the error.
  it('counts a WIB calendar day, not a UTC one', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r, reportTestConfig());
    const depot = randomUUID();

    const place = async (iso: string) => {
      const o = await r.create({ ...orderData({ depotId: depot, total: 50000 }) });
      const row = r.rows.find((x) => x.id === o.id)!;
      row.status = OrderStatus.DELIVERED;
      row.createdAt = new Date(iso);
    };
    await place('2026-07-14T18:00:00.000Z'); // 01:00 WIB on the 15th → counts
    await place('2026-07-15T20:00:00.000Z'); // 03:00 WIB on the 16th → does not

    const rep = await svc.depotDaily(depot, '2026-07-15');
    expect(rep.orders).toBe(1);
    expect(rep.revenueIdr).toBe(50000);
  });

  it('defaults to the WIB today when no date is given', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T19:00:00Z')); // 02:00 WIB, 4 Aug
    try {
      const svc = new ReportService(new InMemoryOrderRepository(), reportTestConfig());
      expect((await svc.depotDaily(randomUUID())).date).toBe('2026-08-04');
    } finally {
      jest.useRealTimers();
    }
  });

  it('composes a depot weekly report: revenueByDay, topProducts and a driverName topCourier', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r, reportTestConfig());
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
    const svc = new ReportService(r, reportTestConfig());
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
    const svc = new ReportService(r, reportTestConfig());
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
    await r.applyStatus(cancelled.id, OrderStatus.CREATED, OrderStatus.CANCELLED, null, null);
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
    const svc = new ReportService(r, reportTestConfig());
    const depot = randomUUID();
    await r.create({ ...orderData({ depotId: depot, total: 10000 }), deliveryFee: 5000 });
    await r.create({ ...orderData({ depotId: depot, total: 10000 }), deliveryFee: 7000 });
    await r.create({ ...orderData({ depotId: null, total: 10000 }), deliveryFee: 9000 }); // unrouted, excluded

    const { items } = await svc.shippingByDepot({});
    expect(items).toEqual([{ depotId: depot, shippingBilled: 12000 }]);
  });

  it('averages ratings per depot from real reviews', async () => {
    const r = new InMemoryOrderRepository();
    const svc = new ReportService(r, reportTestConfig());
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
  const stub = (over: Record<string, unknown>): ReportService => new ReportService(over as never, reportTestConfig());

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
    expect(out).toMatchObject({ gallons: 0, prevGallons: 0, gallonsDelta: 0, growthPct: null });
  });

  // Depot SOP §4: the monthly review is read in galon, against last month.
  describe('monthly gallon figures', () => {
    const gallonOrder = (createdAt: string, qty: number, status = OrderStatus.DELIVERED) => ({
      id: `o-${createdAt}-${qty}`,
      customerId: 'c1',
      status,
      total: qty * 20000,
      createdAt: new Date(createdAt),
      items: [
        {
          productId: 'p1',
          productName: 'Air Galon 19L',
          unit: 'Galon 19L',
          volumeMl: 19000,
          isGallon: true,
          quantity: qty,
        },
      ],
    });
    /**
     * Two windows: May 2026 is the reported month, April 2026 the comparison.
     *
     * Split on the instant, not on `getUTCMonth()` — the bounds are WIB midnights, so
     * May's window starts at 2026-04-30T17:00Z and reads as April in UTC.
     */
    const APRIL_MAY_BOUNDARY = new Date('2026-04-15T00:00:00.000Z');
    const withMonths = (may: unknown[], april: unknown[]) =>
      stub({
        ordersForDepot: async (_d: string, range: { from: Date }) =>
          range.from < APRIL_MAY_BOUNDARY ? april : may,
      });

    it('reports this month, last month, the delta and the growth percentage', async () => {
      const svc = withMonths(
        [gallonOrder('2026-05-04T00:00:00.000Z', 90), gallonOrder('2026-05-20T00:00:00.000Z', 30)],
        [gallonOrder('2026-04-10T00:00:00.000Z', 100)],
      );
      const out = await svc.reportsDepotMonthly('d1', '2026-05');
      expect(out).toMatchObject({
        gallons: 120,
        prevGallons: 100,
        gallonsDelta: 20,
        growthPct: 20,
      });
    });

    it('reports a fall as a negative delta and a negative percentage', async () => {
      const svc = withMonths(
        [gallonOrder('2026-05-04T00:00:00.000Z', 75)],
        [gallonOrder('2026-04-10T00:00:00.000Z', 100)],
      );
      const out = await svc.reportsDepotMonthly('d1', '2026-05');
      expect(out).toMatchObject({ gallonsDelta: -25, growthPct: -25 });
    });

    // Not 0, not Infinity, not "+100%" — there is nothing to grow from.
    it('reports no percentage at all when last month sold nothing', async () => {
      const svc = withMonths([gallonOrder('2026-05-04T00:00:00.000Z', 120)], []);
      const out = await svc.reportsDepotMonthly('d1', '2026-05');
      expect(out).toMatchObject({ gallons: 120, prevGallons: 0, gallonsDelta: 120, growthPct: null });
    });

    it('counts only delivered gallons — a cancelled or in-flight order is not a sale', async () => {
      const svc = withMonths(
        [
          gallonOrder('2026-05-04T00:00:00.000Z', 40),
          gallonOrder('2026-05-05T00:00:00.000Z', 60, OrderStatus.CANCELLED),
          gallonOrder('2026-05-06T00:00:00.000Z', 60, OrderStatus.ON_DELIVERY),
        ],
        [],
      );
      expect((await svc.reportsDepotMonthly('d1', '2026-05')).gallons).toBe(40);
    });

    // A finished month averages over its whole length; the CURRENT month only over the
    // days that have happened, or every review opened on the 3rd reads as a collapse.
    it('averages a finished month over its whole length', async () => {
      const svc = withMonths([gallonOrder('2026-05-04T00:00:00.000Z', 310)], []);
      const out = await svc.reportsDepotMonthly('d1', '2026-05');
      expect(out.avgGallonsPerDay).toBe(10); // 310 / 31, not 310 / 30
    });

    it('averages the current month over the days elapsed so far', async () => {
      jest.useFakeTimers({
        // 5 August 2026, 10:00 WIB — four full days plus one in progress.
        now: new Date('2026-08-05T03:00:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate'],
      });
      try {
        const svc = stub({
          ordersForDepot: async (_d: string, range: { from: Date }) =>
            range.from < new Date('2026-07-15T00:00:00.000Z')
              ? []
              : [gallonOrder('2026-08-02T00:00:00.000Z', 50)],
        });
        expect((await svc.reportsDepotMonthly('d1', '2026-08')).avgGallonsPerDay).toBe(10); // 50 / 5
      } finally {
        jest.useRealTimers();
      }
    });

    it('averages a month that has not started yet as 0 rather than dividing by zero', async () => {
      jest.useFakeTimers({
        now: new Date('2026-08-05T03:00:00.000Z'),
        doNotFake: ['nextTick', 'setImmediate'],
      });
      try {
        const svc = stub({ ordersForDepot: async () => [] });
        expect((await svc.reportsDepotMonthly('d1', '2026-12')).avgGallonsPerDay).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
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

// Depot SOP §1: hr-service asks for a month of local day keys; the service must turn
// them into the WIB window and hand the repository the same zone it bucketed by.
describe('ReportService.depotDailyGallons', () => {
  it('converts inclusive local day keys into a [start, next-day-start) WIB window', async () => {
    const depotDailyGallons = jest.fn(async () => [{ day: '2026-07-01', gallons: 130 }]);
    const svc = new ReportService({ depotDailyGallons } as never, reportTestConfig());

    await expect(svc.depotDailyGallons('d1', '2026-07-01', '2026-07-31')).resolves.toEqual([
      { day: '2026-07-01', gallons: 130 },
    ]);
    // WIB is UTC+7, so 1 July 00:00 WIB is 30 June 17:00Z and the exclusive upper bound
    // is 1 August 00:00 WIB — the whole of the 31st, not up to its morning.
    expect(depotDailyGallons).toHaveBeenCalledWith(
      'd1',
      new Date('2026-06-30T17:00:00.000Z'),
      new Date('2026-07-31T17:00:00.000Z'),
      'Asia/Jakarta',
    );
  });
});

// Depot SOP §3: the twice-daily "laporan penjualan siang/sore", sent to each depot.
describe('ReportService.broadcastDailySales', () => {
  const config = { businessTimeZone: 'Asia/Jakarta', alertPhone: '0800-ops' } as OrderConfigService;
  const orders = {
    depotDailyGallons: jest.fn(async () => [{ day: '2026-08-11', gallons: 137 }]),
  } as never;

  function build(
    contacts: { id: string; name: string; contactPhone: string | null }[] | null,
    overrides: { notify?: jest.Mock; alertPhone?: string } = {},
  ) {
    const notify = overrides.notify ?? jest.fn(async () => undefined);
    const directory = { listContacts: jest.fn(async () => contacts) } as never;
    const svc = new ReportService(
      orders,
      { ...config, alertPhone: overrides.alertPhone ?? '0800-ops' } as OrderConfigService,
      directory,
      { notify } as never,
    );
    return { svc, notify, directory };
  }

  beforeEach(() => jest.clearAllMocks());

  it("sends each depot today's gallon count, to the depot's own number", async () => {
    const { svc, notify } = build([{ id: 'd1', name: 'Depot Cikini', contactPhone: '0811' }]);
    await expect(svc.broadcastDailySales('siang')).resolves.toEqual({ attempted: 1, skipped: 0 });
    expect(notify).toHaveBeenCalledWith(
      'DEPOT_SALES_UPDATE',
      '0811',
      { slot: 'siang', depot: 'Depot Cikini', gallons: '137' },
      null,
      '',
    );
  });

  // A depot with no number of its own is still reported, just to the ops number — dropping
  // it would make an unfilled field look like a depot that sold nothing.
  it('falls back to the ops number when the depot has none', async () => {
    const { svc, notify } = build([{ id: 'd1', name: 'Depot Cikini', contactPhone: null }]);
    await expect(svc.broadcastDailySales('sore')).resolves.toEqual({ attempted: 1, skipped: 0 });
    expect(notify.mock.calls[0]?.[1]).toBe('0800-ops');
    expect(notify.mock.calls[0]?.[2]).toMatchObject({ slot: 'sore' });
  });

  it('skips a depot with no number and no ops fallback, rather than throwing', async () => {
    const { svc, notify } = build([{ id: 'd1', name: 'D', contactPhone: null }], {
      alertPhone: '',
    });
    await expect(svc.broadcastDailySales('siang')).resolves.toEqual({ attempted: 0, skipped: 1 });
    expect(notify).not.toHaveBeenCalled();
  });

  // One failing depot must not cost the rest of the round. The gallon query is what can
  // actually reject here — `notify` is fail-open and swallows its own errors, which is
  // exactly why the count is called `attempted`.
  it('keeps going when one depot fails', async () => {
    const notify = jest
      .fn()
      .mockRejectedValueOnce(new Error('whatsapp down'))
      .mockResolvedValue(undefined);
    const { svc } = build(
      [
        { id: 'd1', name: 'A', contactPhone: '0811' },
        { id: 'd2', name: 'B', contactPhone: '0822' },
      ],
      { notify },
    );
    await expect(svc.broadcastDailySales('siang')).resolves.toEqual({ attempted: 1, skipped: 1 });
  });

  it('does nothing when depot-service cannot answer', async () => {
    const { svc, notify } = build(null);
    await expect(svc.broadcastDailySales('siang')).resolves.toEqual({ attempted: 0, skipped: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  // The ports are optional so every two-argument ReportService in these tests still builds.
  it('does nothing at all when the ports are not wired', async () => {
    const svc = new ReportService(orders, config);
    await expect(svc.broadcastDailySales('siang')).resolves.toEqual({ attempted: 0, skipped: 0 });
  });
});
