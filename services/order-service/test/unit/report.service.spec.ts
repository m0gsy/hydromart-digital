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

  /*
   * The count and the id list must agree, because crm sizes an audience with one and
   * broadcasts to the other — a campaign that shows 300 and messages 40 is the failure
   * this pair exists to prevent. `truncated` is the honest half: a caller that would have
   * under-sent must be able to refuse rather than silently reach part of the segment.
   */
  it('lists the same customers it counted for a frequency segment', async () => {
    const { count } = await reports.segmentEstimate({ minOrders: 2 });
    const listed = await reports.segmentCustomers({ minOrders: 2 });
    expect(listed.customerIds).toEqual([CUST_A]);
    expect(listed.customerIds).toHaveLength(count);
    expect(listed.truncated).toBe(false);
  });

  it('scopes the id list to a depot the same way the count does', async () => {
    const listed = await reports.segmentCustomers({ depotId: DEPOT_B });
    expect(listed.customerIds).toEqual([CUST_B]);
  });

  it('flags truncation instead of quietly returning a partial audience', async () => {
    const listed = await reports.segmentCustomers({}, 1);
    expect(listed.customerIds).toHaveLength(1);
    expect(listed.truncated).toBe(true);
  });

  // The three day-windows are the ones the campaign chips actually send (at-risk, new,
  // still-active), and each is a separate cutoff — a segment that dropped one silently
  // would broadcast to a wider audience than the screen sized.
  it('turns every day-window into the same cutoff the estimate uses', async () => {
    const listed = await reports.segmentCustomers({
      recencyDays: 30,
      newWithinDays: 30,
      lapsedDays: 0.0001, // every seeded order is older than a few seconds ago
    });
    expect(listed.customerIds).toEqual([]);

    const active = await reports.segmentCustomers({ recencyDays: 30, newWithinDays: 30 });
    expect(active.customerIds.sort()).toEqual([CUST_A, CUST_B].sort());
  });

  /*
   * The rows behind a scheduled report. The depot grouping is the interesting one: the
   * aggregate knows only depotIds, and a spreadsheet full of UUIDs is not a report — but a
   * depot-service outage must not stop the report either, so the id is the fallback.
   */
  describe('exportRows', () => {
    it('labels depot rows with the depot name when depot-service answers', async () => {
      const withNames = new ReportService(repo, reportTestConfig(), {
        listContacts: async () => [{ id: DEPOT_A, name: 'Depot Cibubur', contactPhone: null }],
      } as never);
      const { rows } = await withNames.exportRows('REVENUE_BY_DEPOT', {});
      expect(rows.find((r) => r.label === 'Depot Cibubur')).toBeDefined();
    });

    it('falls back to the depot id rather than dropping the report', async () => {
      const { rows, truncated } = await reports.exportRows('REVENUE_BY_DEPOT', {});
      expect(rows.every((r) => r.orders > 0)).toBe(true);
      expect(rows.some((r) => r.label === DEPOT_A)).toBe(true);
      // Two depots, cap of 100 — a short report, and it says so rather than staying silent.
      expect(truncated).toBe(false);
    });

    it('labels product rows with the product name', async () => {
      const r2 = new InMemoryOrderRepository();
      const svc = new ReportService(r2, reportTestConfig());
      await r2.create({
        ...orderData({ total: 40000 }),
        items: [
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
        ],
      });
      const out = await svc.exportRows('REVENUE_BY_PRODUCT', {});
      expect(out.rows).toEqual([{ label: 'Galon 19L', orders: 1, revenue: 40000 }]);
      expect(out.truncated).toBe(false);
    });

    /*
     * E-4. EXPORT_ROWS is 100 and the spreadsheet said nothing when it was reached: a
     * network past its 100th depot handed finance a report that simply stopped, and a short
     * month and a cut-off month look identical once they are rows in a file. Its neighbour
     * `segmentCustomers` has reported this since it was written; this one did not.
     */
    it('reports a report that hit the row cap as truncated', async () => {
      const repoAtCap = {
        topDepots: async () =>
          Array.from({ length: 100 }, (_, i) => ({
            depotId: `depot-${i}`,
            orderCount: 1,
            revenue: 1000,
          })),
      } as never;
      const svc = new ReportService(repoAtCap, reportTestConfig());

      const out = await svc.exportRows('REVENUE_BY_DEPOT', {});

      expect(out.rows).toHaveLength(100);
      expect(out.truncated).toBe(true);
    });
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
    expect(rep.perCourier).toEqual([]); // no courier was ever assigned, not "unavailable"
    expect(rep.codCollectedIdr).toBeNull(); // no payment port wired on this instance
    expect(rep.cashInDrawerIdr).toBeNull();
    expect(rep.gallonsReturned).toBeNull(); // no depot-returns port wired on this instance
    expect(rep.gallonsDamaged).toBeNull();
  });

  /*
   * S2. `perCourier`, `codCollectedIdr` and `cashInDrawerIdr` were literal `[]`/`null`, so
   * "Rincian per kurir belum tersedia" and `hint="Selisih —"` on the reports screen were
   * the client honestly rendering a backend that never intended to answer.
   *
   * The split matters and is asserted rather than assumed: courier COD is cash on the day's
   * DELIVERY orders (payment rows carry no depotId), counter cash is what payment-service
   * booked against the depot. Summing one bucket into the other double-counts a walk-in.
   */
  describe('depot daily — courier split and the two cash buckets', () => {
    const day = '2026-07-15';
    const gallon = (qty: number) => [
      {
        productId: randomUUID(),
        productName: 'Galon 19L',
        sku: 'G19',
        unit: 'Galon',
        volumeMl: 19000,
        isGallon: true,
        unitPrice: 20000,
        quantity: qty,
        lineTotal: 20000 * qty,
      },
    ];

    it('breaks the day down per courier and separates COD from counter cash', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const mk = async (over: {
        total: number;
        driver?: string;
        status?: OrderStatus;
        walkIn?: boolean;
      }) => {
        const o = await r.create({
          ...orderData({ depotId: depot, total: over.total }),
          items: gallon(2),
        });
        const row = r.rows.find((x) => x.id === o.id)!;
        row.createdAt = new Date(`${day}T02:00:00.000Z`);
        row.status = over.status ?? OrderStatus.DELIVERED;
        row.driverName = over.driver ?? null;
        row.isWalkIn = over.walkIn === true;
        return o;
      };
      const budiA = await mk({ total: 40000, driver: 'Budi' });
      const budiB = await mk({ total: 60000, driver: 'Budi' });
      const budiFailed = await mk({
        total: 30000,
        driver: 'Budi',
        status: OrderStatus.CANCELLED,
      });
      const sari = await mk({ total: 50000, driver: 'Sari' });
      const counter = await mk({ total: 25000, walkIn: true });

      const cash = {
        cashByOrder: jest.fn(async (ids: string[]) =>
          [
            { orderId: budiA.id, amountIdr: 40000 },
            { orderId: sari.id, amountIdr: 50000 },
          ].filter((row) => ids.includes(row.orderId)),
        ),
        depotCash: jest.fn(async () => 25000),
      };
      const svc = new ReportService(
        r,
        reportTestConfig(),
        undefined,
        undefined,
        cash as never,
      );

      const rep = await svc.depotDaily(depot, day);

      // Courier COD is the day's DELIVERY orders only — the counter sale is not a courier's.
      expect(cash.cashByOrder).toHaveBeenCalledTimes(1);
      const asked = cash.cashByOrder.mock.calls[0][0];
      expect(asked).toEqual(expect.arrayContaining([budiA.id, budiB.id, sari.id]));
      expect(asked).not.toContain(counter.id);

      expect(rep.codCollectedIdr).toBe(90000);
      expect(rep.cashInDrawerIdr).toBe(25000);
      expect(rep.perCourier).toEqual([
        { name: 'Budi', completed: 2, failed: 1, codIdr: 40000 },
        { name: 'Sari', completed: 1, failed: 0, codIdr: 50000 },
      ]);
      // The cancelled order is a failed delivery for Budi and revenue for nobody.
      expect(rep.failedDeliveries).toBe(1);
      expect(budiFailed).toBeDefined();
    });

    it('reports courier COD as null when payment-service could not answer', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const o = await r.create({
        ...orderData({ depotId: depot, total: 40000 }),
        items: gallon(2),
      });
      const row = r.rows.find((x) => x.id === o.id)!;
      row.createdAt = new Date(`${day}T02:00:00.000Z`);
      row.status = OrderStatus.DELIVERED;
      row.driverName = 'Budi';

      const svc = new ReportService(r, reportTestConfig(), undefined, undefined, {
        cashByOrder: async () => null,
        depotCash: async () => null,
      } as never);

      const rep = await svc.depotDaily(depot, day);
      // Null, never 0: "payment-service is down" and "the courier collected nothing" are
      // different answers, and one of them means somebody is holding cash.
      expect(rep.codCollectedIdr).toBeNull();
      expect(rep.cashInDrawerIdr).toBeNull();
      expect(rep.perCourier).toEqual([{ name: 'Budi', completed: 1, failed: 0, codIdr: null }]);
    });

    // The return slip is written in depot-service, so order-service cannot know this on its
    // own — but "nothing came back today" is a real operational fact and must not be
    // indistinguishable from "depot-service did not answer".
    it('reads gallons returned and damaged from depot-service', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const directory = {
        gallonReturns: jest.fn(async () => ({ gallons: 14, damaged: 3 })),
      };
      const svc = new ReportService(r, reportTestConfig(), directory as never);

      const rep = await svc.depotDaily(depot, day);
      expect(rep.gallonsReturned).toBe(14);
      expect(rep.gallonsDamaged).toBe(3);
      // Same window the orders were counted in — a returns figure from a different day
      // next to this day's sales is a reconciliation that cannot be closed.
      const [askedDepot, from, to] = directory.gallonReturns.mock.calls[0] as unknown as [
        string,
        Date,
        Date,
      ];
      expect(askedDepot).toBe(depot);
      expect(from.toISOString()).toBe('2026-07-14T17:00:00.000Z'); // 00:00 WIB on the 15th
      expect(to.toISOString()).toBe('2026-07-15T17:00:00.000Z');
    });

    it('leaves both gallon columns null when depot-service could not answer', async () => {
      const r = new InMemoryOrderRepository();
      const svc = new ReportService(r, reportTestConfig(), {
        gallonReturns: async () => null,
      } as never);
      const rep = await svc.depotDaily(randomUUID(), day);
      expect(rep.gallonsReturned).toBeNull();
      expect(rep.gallonsDamaged).toBeNull();
    });

    it('skips the payment round-trip entirely on a day with no delivery orders', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const cash = {
        cashByOrder: jest.fn(async () => []),
        depotCash: jest.fn(async () => 0),
      };
      const svc = new ReportService(
        r,
        reportTestConfig(),
        undefined,
        undefined,
        cash as never,
      );

      const rep = await svc.depotDaily(depot, day);
      expect(cash.cashByOrder).not.toHaveBeenCalled();
      expect(rep.codCollectedIdr).toBe(0);
      expect(rep.cashInDrawerIdr).toBe(0);
    });
  });

  /*
   * S2. `slaPct` was a literal null with a TODO, and `dashboard/compare` + the monthly
   * review's Governance panel rendered that null as "—". order-service genuinely cannot
   * derive it — an order's status says it was delivered, never whether it was late — so
   * the fix is to ask delivery-service, not to infer.
   */
  describe('monthly review — on-time rate', () => {
    it('reads the depot on-time rate for the month window and reports it as a percentage', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const sla = { onTimeRate: jest.fn(async () => 0.876) };
      const svc = new ReportService(
        r,
        reportTestConfig(),
        undefined,
        undefined,
        undefined,
        sla as never,
      );

      const rep = await svc.reportsDepotMonthly(depot, '2026-07');
      // One decimal on purpose: whole points turn 87,6% into 88%, right at the band the HQ
      // dashboard changes colour on.
      expect(rep.slaPct).toBe(87.6);
      const [askedDepot, from, to] = sla.onTimeRate.mock.calls[0] as unknown as [
        string,
        Date,
        Date,
      ];
      expect(askedDepot).toBe(depot);
      expect(from.toISOString()).toBe('2026-06-30T17:00:00.000Z'); // 1 Jul 00:00 WIB
      expect(to.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    });

    it('leaves slaPct null when delivery-service could not answer', async () => {
      const r = new InMemoryOrderRepository();
      const svc = new ReportService(r, reportTestConfig(), undefined, undefined, undefined, {
        onTimeRate: async () => null,
      } as never);
      expect((await svc.reportsDepotMonthly(randomUUID(), '2026-07')).slaPct).toBeNull();
    });

    it('leaves slaPct null when no delivery port is wired at all', async () => {
      const r = new InMemoryOrderRepository();
      const svc = new ReportService(r, reportTestConfig());
      expect((await svc.reportsDepotMonthly(randomUUID(), '2026-07')).slaPct).toBeNull();
    });
  });

  /*
   * S2 + the user's 2026-08-13 decision: net profit = omzet − HPP − gaji − beban. The data
   * to do it properly does not exist (no per-unit cost price anywhere in the catalog), so
   * HPP is purchases RECEIVED in the month and the breakdown ships with the number so a
   * reader can see that rather than be misled by it.
   */
  /*
   * The Governance panel used to be three literal '—' strings in the client. All three
   * numbers are depot-service's own (approvals, stock counts, the daily close), so they
   * arrive over the same port the costs do — and a depot-service that cannot be read leaves
   * the panel null rather than reporting a clean month.
   */
  describe('monthly review — governance', () => {
    const svcWithPort = (r: InMemoryOrderRepository, port: unknown) =>
      new ReportService(
        r,
        reportTestConfig(),
        undefined,
        undefined,
        undefined,
        undefined,
        port as never,
      );

    it('reports the depot figures for the month window', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const governance = jest.fn(async () => ({
        approvalsReviewed: 3,
        opnameVarianceIdr: -40_000,
        settlementVarianceIdr: -20_000,
        daysClosed: 30,
      }));
      const rep = await svcWithPort(r, {
        costs: async () => null,
        payroll: async () => null,
        governance,
      }).reportsDepotMonthly(depot, '2026-07');

      expect(rep.governance).toEqual({
        approvalsReviewed: 3,
        opnameVarianceIdr: -40_000,
        settlementVarianceIdr: -20_000,
        daysClosed: 30,
      });
      const [askedDepot, from, to] = governance.mock.calls[0] as unknown as [string, Date, Date];
      expect(askedDepot).toBe(depot);
      expect(from.toISOString()).toBe('2026-06-30T17:00:00.000Z'); // 1 Jul 00:00 WIB
      expect(to.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    });

    it('leaves governance null when depot-service could not answer', async () => {
      const r = new InMemoryOrderRepository();
      const rep = await svcWithPort(r, {
        costs: async () => null,
        payroll: async () => null,
        governance: async () => null,
      }).reportsDepotMonthly(randomUUID(), '2026-07');
      expect(rep.governance).toBeNull();
    });

    it('leaves governance null when no depot-cost port is wired at all', async () => {
      const r = new InMemoryOrderRepository();
      const rep = await new ReportService(r, reportTestConfig()).reportsDepotMonthly(
        randomUUID(),
        '2026-07',
      );
      expect(rep.governance).toBeNull();
    });
  });

  describe('monthly review — net profit', () => {
    const costsPort = (over: Record<string, unknown> = {}) => ({
      costs: async () => ({ cogsIdr: 4_000_000, opexIdr: 1_900_000 }),
      payroll: async () => 3_000_000,
      governance: async () => null,
      ...over,
    });
    const svcWith = (r: InMemoryOrderRepository, port: unknown) =>
      new ReportService(r, reportTestConfig(), undefined, undefined, undefined, undefined, port as never);

    const withRevenue = async (r: InMemoryOrderRepository, depot: string, total: number) => {
      const o = await r.create({ ...orderData({ depotId: depot, total }) });
      r.rows.find((x) => x.id === o.id)!.createdAt = new Date('2026-07-10T02:00:00.000Z');
      r.rows.find((x) => x.id === o.id)!.status = OrderStatus.DELIVERED;
    };

    it('subtracts goods, payroll and operating cost, and shows the arithmetic', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      await withRevenue(r, depot, 12_000_000);

      const rep = await svcWith(r, costsPort()).reportsDepotMonthly(depot, '2026-07');
      expect(rep.revenueIdr).toBe(12_000_000);
      expect(rep.netProfitIdr).toBe(12_000_000 - 4_000_000 - 3_000_000 - 1_900_000);
      expect(rep.profitBreakdown).toEqual({
        revenueIdr: 12_000_000,
        cogsIdr: 4_000_000,
        payrollIdr: 3_000_000,
        opexIdr: 1_900_000,
      });
    });

    it('asks hr for the reported month, not for whatever month it is today', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const payroll = jest.fn(async () => 3_000_000);
      await svcWith(r, costsPort({ payroll })).reportsDepotMonthly(depot, '2026-07');
      expect(payroll).toHaveBeenCalledWith(depot, '2026-07');
    });

    /*
     * Fail-closed, and this is the test that matters. Reading an unreachable hr-service as
     * "payroll was zero" publishes a profit inflated by the depot's entire wage bill — and
     * it looks exactly like a good month.
     */
    it.each([
      ['depot-service could not answer', { costs: async () => null }],
      ['hr-service could not answer', { payroll: async () => null }],
    ])('reports null net profit when %s, never a partial subtraction', async (_label, over) => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      await withRevenue(r, depot, 12_000_000);

      const rep = await svcWith(r, costsPort(over)).reportsDepotMonthly(depot, '2026-07');
      expect(rep.netProfitIdr).toBeNull();
      // The breakdown still ships: knowing WHICH half failed is what turns "—" from a dead
      // end into something an operator can chase.
      expect(rep.profitBreakdown.revenueIdr).toBe(12_000_000);
      const missing = [rep.profitBreakdown.cogsIdr, rep.profitBreakdown.payrollIdr].filter(
        (v) => v === null,
      );
      expect(missing.length).toBeGreaterThan(0);
    });

    it('reports null with no cost port wired at all', async () => {
      const r = new InMemoryOrderRepository();
      const rep = await new ReportService(r, reportTestConfig()).reportsDepotMonthly(
        randomUUID(),
        '2026-07',
      );
      expect(rep.netProfitIdr).toBeNull();
      expect(rep.profitBreakdown).toEqual({
        revenueIdr: 0,
        cogsIdr: null,
        opexIdr: null,
        payrollIdr: null,
      });
    });

    it('reports a loss as a negative number rather than flooring at zero', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      await withRevenue(r, depot, 1_000_000);
      const rep = await svcWith(r, costsPort()).reportsDepotMonthly(depot, '2026-07');
      expect(rep.netProfitIdr).toBe(1_000_000 - 8_900_000);
    });
  });

  /*
   * S2. `dashboard/compare` had three of its five rows as `value: () => null` in the CLIENT,
   * with a comment saying order-service could not join them. It still cannot — so it asks
   * the three services that own them. A comparison screen where three of five rows are
   * permanently "—" is a screen nobody opens.
   */
  describe('cross-depot compare — the three columns that were permanently "—"', () => {
    const RANGE = { from: new Date('2026-06-30T17:00:00.000Z'), to: new Date('2026-07-31T17:00:00.000Z') };

    const build = (r: InMemoryOrderRepository) =>
      new ReportService(
        r,
        reportTestConfig(),
        { gallonReturns: async () => ({ gallons: 20, damaged: 4 }) } as never,
        undefined,
        undefined,
        { onTimeRate: async () => 0.912 } as never,
        {
          costs: async () => ({ cogsIdr: 4_000_000, opexIdr: 1_900_000 }),
          payroll: async () => 3_000_000,
        } as never,
      );

    it('fills SLA, wastage and net profit per depot', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const o = await r.create({ ...orderData({ depotId: depot, total: 12_000_000 }) });
      r.rows.find((x) => x.id === o.id)!.createdAt = new Date('2026-07-10T02:00:00.000Z');

      const rep = await build(r).reportsDepotCompare([depot], RANGE);
      expect(rep.depots[0]).toEqual({
        depotId: depot,
        orders: 1,
        revenueIdr: 12_000_000,
        slaPct: 91.2,
        wastageGallons: 4,
        netProfitIdr: 12_000_000 - 4_000_000 - 3_000_000 - 1_900_000,
      });
    });

    /*
     * An open window cannot be asked about. SLA, costs and returns are all range reads, and
     * an unbounded compare would quietly charge one column with a depot's whole history
     * while the revenue beside it covered every order ever placed — two columns describing
     * different spans of time, side by side, with nothing saying so.
     */
    it('keeps the two order-owned columns and nulls the rest when the window is open', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      await r.create({ ...orderData({ depotId: depot, total: 50_000 }) });

      const rep = await build(r).reportsDepotCompare([depot], {});
      expect(rep.depots[0]).toMatchObject({
        orders: 1,
        revenueIdr: 50_000,
        slaPct: null,
        wastageGallons: null,
        netProfitIdr: null,
      });
    });

    it('nulls a depot column whose owning service went quiet, without dropping the row', async () => {
      const r = new InMemoryOrderRepository();
      const depot = randomUUID();
      const svc = new ReportService(
        r,
        reportTestConfig(),
        { gallonReturns: async () => null } as never,
        undefined,
        undefined,
        { onTimeRate: async () => null } as never,
        { costs: async () => null, payroll: async () => null } as never,
      );

      const rep = await svc.reportsDepotCompare([depot], RANGE);
      // The row is still there — a depot missing from a comparison reads as a depot that
      // sold nothing, which is a different and much worse claim.
      expect(rep.depots).toHaveLength(1);
      expect(rep.depots[0]).toMatchObject({
        orders: 0,
        slaPct: null,
        wastageGallons: null,
        netProfitIdr: null,
      });
    });
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
