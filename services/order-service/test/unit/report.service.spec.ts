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
        { productId: p1, productName: 'Galon 19L', sku: 'G19', unit: 'Galon', unitPrice: 20000, quantity: 2, lineTotal: 40000 },
        { productId: p2, productName: 'Air 600ml', sku: 'A600', unit: 'Dus', unitPrice: 20000, quantity: 1, lineTotal: 20000 },
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
});
