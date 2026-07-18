import { Inject, Injectable } from '@nestjs/common';

import { OrderStatus } from '../../domain/order-status';
import {
  CustomerSales,
  DepotSales,
  DepotRating,
  DepotRefund,
  DepotShipping,
  OrderRecord,
  OrderRepository,
  ProductRevenue,
  ReportRange,
  SalesBucket,
} from '../ports/order.repository';
import { ORDER_TOKENS } from '../tokens';

export interface ReportRangeView {
  from: string | null;
  to: string | null;
}

export interface SalesReport extends ReportRangeView {
  granularity: 'daily' | 'monthly';
  buckets: SalesBucket[];
}

export interface RevenueByProductReport extends ReportRangeView {
  /** Always 'product' — order-service has no category column (see revenueByProduct). */
  grouping: 'product';
  items: (ProductRevenue & { share: number })[];
}

export interface RetentionCohortRow {
  /** Cohort's first-order month, 'YYYY-MM'. */
  label: string;
  cohortSize: number;
  /** Retention ratio 0..1 for month 0, 1, 2, … since the cohort month. */
  cells: number[];
}

export interface RetentionCohortReport extends ReportRangeView {
  rows: RetentionCohortRow[];
}

export interface CustomerSummary {
  customerId: string;
  orderCount: number;
  revenue: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  recentOrders: {
    id: string;
    orderNumber: string;
    status: string;
    total: number;
    createdAt: string;
  }[];
}

/** One courier's line in the depot daily report (design 2d). */
export interface DepotCourierDaily {
  name: string;
  completed: number;
  failed: number;
  codIdr: number;
}

/** Depot Operator "Laporan harian" composite (design cell 2d). */
export interface DepotDailyReport {
  depotId: string;
  /** The reported day, 'YYYY-MM-DD' (UTC). */
  date: string;
  orders: number;
  revenueIdr: number;
  gallonsDelivered: number;
  gallonsReturned: number;
  gallonsDamaged: number;
  codCollectedIdr: number;
  failedDeliveries: number;
  perCourier: DepotCourierDaily[];
}

/** One depot's row in the cross-depot comparison (design 14d compare). */
export interface DepotCompareRow {
  depotId: string;
  orders: number;
  revenueIdr: number;
}

/** Cross-depot comparison over a window (design 14d). SLA/wastage are omitted — no order source. */
export interface DepotCompareReport extends ReportRangeView {
  depots: DepotCompareRow[];
}

/**
 * Depot "Tinjauan ops bulanan" composite for the monthly review screen. orders/revenue/
 * activeCustomers are real order-service figures; netProfit + SLA are null (no source);
 * topCourier is derived from the order's own driverName (delivered count, no rating).
 */
export interface DepotMonthlyReport {
  depotId: string;
  /** Reported month, 'YYYY-MM'. */
  month: string;
  orders: number;
  revenueIdr: number;
  /** Distinct customers with a non-cancelled order in the month. */
  activeCustomers: number;
  /** Null — net profit needs cost-of-goods + expenses (payout/procurement), not joinable here. */
  netProfitIdr: number | null;
  /** Null — SLA on-time needs delivery-service timings, no order-service source. */
  slaPct: number | null;
  topCourier?: { name: string; delivered: number };
}

/** Depot Operator "Laporan mingguan" composite (design cell 7d). */
export interface DepotWeeklyReport {
  depotId: string;
  from: string;
  to: string;
  orders: number;
  revenueIdr: number;
  avgPerDayIdr: number;
  /** Omitted — SLA on-time needs delivery-service data (no order-service source). */
  slaOnTimePct?: number;
  revenueByDay: { day: string; revenueIdr: number }[];
  topProducts: { label: string; qty: number }[];
  topCourier?: { name: string; delivered: number; rating?: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A line item counts as a gallon (galon) when its unit or product name says so. */
function isGallon(unit: string, productName: string): boolean {
  return /galon/i.test(unit) || /galon/i.test(productName);
}
function gallonQty(order: OrderRecord): number {
  return order.items.reduce((s, i) => s + (isGallon(i.unit, i.productName) ? i.quantity : 0), 0);
}
const isDelivered = (s: OrderStatus): boolean =>
  s === OrderStatus.DELIVERED || s === OrderStatus.COMPLETED;

/** Sales/customer/depot aggregates over the order book (PRD Module 13, FR-095..098). */
@Injectable()
export class ReportService {
  private static readonly MAX_LIMIT = 100;

  constructor(
    @Inject(ORDER_TOKENS.OrderRepository) private readonly orders: OrderRepository,
  ) {}

  async sales(
    granularity: 'daily' | 'monthly',
    range: ReportRange,
  ): Promise<SalesReport> {
    const buckets = await this.orders.salesSeries(granularity, range);
    return { granularity, ...ReportService.rangeView(range), buckets };
  }

  async topCustomers(
    range: ReportRange,
    limit: number,
  ): Promise<ReportRangeView & { items: CustomerSales[] }> {
    const items = await this.orders.topCustomers(range, ReportService.clampLimit(limit));
    return { ...ReportService.rangeView(range), items };
  }

  async topDepots(
    range: ReportRange,
    limit: number,
  ): Promise<ReportRangeView & { items: DepotSales[] }> {
    const items = await this.orders.topDepots(range, ReportService.clampLimit(limit));
    return { ...ReportService.rangeView(range), items };
  }

  async shippingByDepot(range: ReportRange): Promise<ReportRangeView & { items: DepotShipping[] }> {
    const items = await this.orders.shippingByDepot(range);
    return { ...ReportService.rangeView(range), items };
  }

  async refundsByDepot(range: ReportRange): Promise<ReportRangeView & { items: DepotRefund[] }> {
    const items = await this.orders.refundsByDepot(range);
    return { ...ReportService.rangeView(range), items };
  }

  async ratingByDepot(range: ReportRange): Promise<ReportRangeView & { items: DepotRating[] }> {
    const items = await this.orders.ratingByDepot(range);
    return { ...ReportService.rangeView(range), items };
  }

  async revenueByProduct(range: ReportRange, limit: number): Promise<RevenueByProductReport> {
    const items = await this.orders.revenueByProduct(range, ReportService.clampLimit(limit));
    const total = items.reduce((s, i) => s + i.revenue, 0);
    return {
      grouping: 'product',
      ...ReportService.rangeView(range),
      items: items.map((i) => ({ ...i, share: total > 0 ? i.revenue / total : 0 })),
    };
  }

  async retentionCohort(range: ReportRange): Promise<RetentionCohortReport> {
    const cells = await this.orders.retentionCohort(range);
    const byCohort = new Map<string, Map<number, number>>();
    for (const c of cells) {
      const m = byCohort.get(c.cohort) ?? new Map<number, number>();
      m.set(c.monthIndex, c.customers);
      byCohort.set(c.cohort, m);
    }
    const rows: RetentionCohortRow[] = [...byCohort.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, m]) => {
        const size = m.get(0) ?? 0;
        const maxIndex = Math.max(...m.keys());
        const cellRatios: number[] = [];
        for (let i = 0; i <= maxIndex; i++) {
          cellRatios.push(size > 0 ? (m.get(i) ?? 0) / size : 0);
        }
        return { label, cohortSize: size, cells: cellRatios };
      });
    return { ...ReportService.rangeView(range), rows };
  }

  /**
   * Opt-in reachable audience for a broadcast (design 10d) — distinct customers with a
   * non-cancelled order, optionally scoped to one depot. Activity-based (every order has
   * a phone); it does NOT include registered customers who have never ordered.
   */
  async audienceReach(depotId?: string): Promise<{ depotId: string | null; count: number }> {
    const count = await this.orders.audienceReach(depotId);
    return { depotId: depotId ?? null, count };
  }

  /**
   * Live size of an activity-based segment (design 21d). Recency/frequency/depot are
   * resolved here; `tier` is loyalty-owned and not joinable, so the caller supplies only
   * the conditions this service can honour and badges `tier` itself.
   */
  async segmentEstimate(input: {
    recencyDays?: number;
    lapsedDays?: number;
    newWithinDays?: number;
    minOrders?: number;
    depotId?: string;
  }): Promise<{ count: number; recencyDays: number | null; minOrders: number | null; depotId: string | null }> {
    const daysAgo = (d: number): Date => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const count = await this.orders.segmentEstimate({
      recencyCutoff: input.recencyDays != null ? daysAgo(input.recencyDays) : undefined,
      lapsedCutoff: input.lapsedDays != null ? daysAgo(input.lapsedDays) : undefined,
      firstOrderCutoff: input.newWithinDays != null ? daysAgo(input.newWithinDays) : undefined,
      minOrders: input.minOrders,
      depotId: input.depotId,
    });
    return {
      count,
      recencyDays: input.recencyDays ?? null,
      minOrders: input.minOrders ?? null,
      depotId: input.depotId ?? null,
    };
  }

  async customerSummary(customerId: string): Promise<CustomerSummary> {
    const [life, recent] = await Promise.all([
      this.orders.customerLifetime(customerId),
      this.orders.search({ customerId, page: 1, limit: 5 }),
    ]);
    return {
      customerId,
      orderCount: life.orderCount,
      revenue: life.revenue,
      firstOrderAt: life.firstOrderAt ? life.firstOrderAt.toISOString() : null,
      lastOrderAt: life.lastOrderAt ? life.lastOrderAt.toISOString() : null,
      recentOrders: recent.items.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Depot daily report (design 2d). orders/revenue/gallonsDelivered are real order-service
   * figures; failedDeliveries is a best-effort cancelled-count. codCollected, gallon
   * returned/damaged and the per-courier breakdown need delivery/depot/payment-service
   * data order-service can't join here (see the TODOs).
   */
  async depotDaily(depotId: string, date: string): Promise<DepotDailyReport> {
    const from = new Date(`${date}T00:00:00.000Z`);
    const to = new Date(from.getTime() + DAY_MS);
    const rows = await this.orders.ordersForDepot(depotId, { from, to });
    const live = rows.filter((r) => r.status !== OrderStatus.CANCELLED);
    const delivered = live.filter((r) => isDelivered(r.status));
    return {
      depotId,
      date,
      orders: live.length,
      revenueIdr: Math.round(live.reduce((s, r) => s + r.total, 0)),
      gallonsDelivered: delivered.reduce((s, r) => s + gallonQty(r), 0),
      gallonsReturned: 0, // TODO: join depot-service gallon-returns (retur masuk)
      gallonsDamaged: 0, // TODO: join depot-service gallon-returns (rusak)
      codCollectedIdr: 0, // TODO: join payment-service COD settlement
      failedDeliveries: rows.filter((r) => r.status === OrderStatus.CANCELLED).length,
      perCourier: [], // TODO: join delivery-service performance
    };
  }

  /**
   * Depot weekly report (design 7d). Defaults to the trailing 7 days when the window is
   * open. orders/revenue/revenueByDay/topProducts are real; topCourier is derived from the
   * order's own driverName (delivered count, no rating). slaOnTimePct is omitted (no source).
   */
  async depotWeekly(depotId: string, from?: Date, to?: Date): Promise<DepotWeeklyReport> {
    const toDate = to ?? new Date();
    const fromDate = from ?? new Date(toDate.getTime() - 7 * DAY_MS);
    const rows = await this.orders.ordersForDepot(depotId, { from: fromDate, to: toDate });
    const live = rows.filter((r) => r.status !== OrderStatus.CANCELLED);
    const revenueIdr = Math.round(live.reduce((s, r) => s + r.total, 0));
    const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS));

    const byDay = new Map<string, number>();
    const byProduct = new Map<string, number>();
    const byCourier = new Map<string, number>();
    for (const o of live) {
      const day = o.createdAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + o.total);
      for (const i of o.items) byProduct.set(i.productName, (byProduct.get(i.productName) ?? 0) + i.quantity);
      if (isDelivered(o.status) && o.driverName)
        byCourier.set(o.driverName, (byCourier.get(o.driverName) ?? 0) + 1);
    }
    const topProducts = [...byProduct.entries()]
      .map(([label, qty]) => ({ label, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
    const top = [...byCourier.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      depotId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      orders: live.length,
      revenueIdr,
      avgPerDayIdr: Math.round(revenueIdr / days),
      revenueByDay: [...byDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, r]) => ({ day, revenueIdr: Math.round(r) })),
      topProducts,
      // topCourier from order-owned driverName (real delivered count); rating is review-owned.
      ...(top ? { topCourier: { name: top[0], delivered: top[1] } } : {}),
    };
  }

  /**
   * Cross-depot comparison (design 14d). One row per requested depot with real
   * orders/revenue (cancelled excluded); depots with no orders come back as zeroes so
   * every requested column renders. SLA/wastage are intentionally absent (no order source).
   */
  async reportsDepotCompare(depotIds: string[], range: ReportRange): Promise<DepotCompareReport> {
    const depots = await Promise.all(
      depotIds.map(async (depotId) => {
        const rows = await this.orders.ordersForDepot(depotId, range);
        const live = rows.filter((r) => r.status !== OrderStatus.CANCELLED);
        return {
          depotId,
          orders: live.length,
          revenueIdr: Math.round(live.reduce((s, r) => s + r.total, 0)),
        };
      }),
    );
    return { ...ReportService.rangeView(range), depots };
  }

  /**
   * One depot's monthly ops review (monthly-review screen). `month` is 'YYYY-MM'; the
   * window is [first-of-month, first-of-next-month). orders/revenue/activeCustomers are
   * real; topCourier is derived from driverName. netProfit + SLA are null (see interface).
   */
  async reportsDepotMonthly(depotId: string, month: string): Promise<DepotMonthlyReport> {
    const from = new Date(`${month}-01T00:00:00.000Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const rows = await this.orders.ordersForDepot(depotId, { from, to });
    const live = rows.filter((r) => r.status !== OrderStatus.CANCELLED);
    const byCourier = new Map<string, number>();
    for (const o of live) {
      if (isDelivered(o.status) && o.driverName)
        byCourier.set(o.driverName, (byCourier.get(o.driverName) ?? 0) + 1);
    }
    const top = [...byCourier.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      depotId,
      month,
      orders: live.length,
      revenueIdr: Math.round(live.reduce((s, r) => s + r.total, 0)),
      activeCustomers: new Set(live.map((r) => r.customerId)).size,
      // TODO: net profit needs cost-of-goods + expenses (payout/procurement) — not joinable here.
      netProfitIdr: null,
      // TODO: SLA on-time needs delivery-service timings — no order-service source.
      slaPct: null,
      ...(top ? { topCourier: { name: top[0], delivered: top[1] } } : {}),
    };
  }

  private static clampLimit(limit: number): number {
    return Math.min(ReportService.MAX_LIMIT, Math.max(1, Math.floor(limit)));
  }

  private static rangeView(range: ReportRange): ReportRangeView {
    return {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
    };
  }
}
