import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { addLocalDays, addLocalMonths, dayStartUtc, localDayKey } from '@hydromart/platform';

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
import { DepotDirectoryPort } from '../ports/depot-directory.port';
import { NotificationPort } from '../ports/notification.port';
import { PaymentCashPort } from '../ports/payment-cash.port';
import { DeliverySlaPort } from '../ports/delivery-sla.port';
import { DepotGovernanceFigures, DepotCostBreakdown, DepotCostsPort } from '../ports/depot-costs.port';
import { OrderConfigService } from '../../config/order-config.service';
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

/** One depot's customer ratings aggregate for the ratings screen (design 14b). */
export interface DepotRatingsReport extends ReportRangeView {
  depotId: string;
  average: number | null;
  count: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  recent: { customerName: string; stars: number; comment: string | null; createdAt: string }[];
}

/** One courier's line in the depot daily report (design 2d). */
export interface DepotCourierDaily {
  name: string;
  completed: number;
  failed: number;
  /** Null when payment-service could not be read — not 0, which would read as "collected nothing". */
  codIdr: number | null;
}

/**
 * One order on the daily export. Cancelled rows are carried and flagged rather than
 * filtered: a file that quietly omits them cannot be reconciled against the till.
 */
export interface DepotDailyRow {
  orderNumber: string;
  createdAt: string;
  status: string;
  cancelled: boolean;
  recipientName: string;
  driverName: string | null;
  gallons: number;
  subtotalIdr: number;
  deliveryFeeIdr: number;
  discountIdr: number;
  totalIdr: number;
  isWalkIn: boolean;
}

/** Depot Operator "Laporan harian" composite (design cell 2d). */
export interface DepotDailyReport {
  depotId: string;
  /** The reported day, 'YYYY-MM-DD' (UTC). */
  date: string;
  orders: number;
  revenueIdr: number;
  gallonsDelivered: number;
  // null (not 0) when the owning service could not be read. Consistent with ARCH-1: emit
  // null so the FE renders "—" rather than a fabricated zero that reads as a measurement.
  gallonsReturned: number | null;
  gallonsDamaged: number | null;
  /** Cash the couriers collected on the day's DELIVERY orders. Excludes counter sales. */
  codCollectedIdr: number | null;
  /** Counter cash payment-service booked against this depot in the same window. */
  cashInDrawerIdr: number | null;
  failedDeliveries: number;
  perCourier: DepotCourierDaily[];
}

/** One depot's row in the cross-depot comparison (design 14d compare). */
export interface DepotCompareRow {
  depotId: string;
  orders: number;
  revenueIdr: number;
  /** On-time share, 0..100 with one decimal. Null when delivery-service could not be read. */
  slaPct: number | null;
  /** Gallons that came back damaged in the window (depot-service). Null when unreadable. */
  wastageGallons: number | null;
  /** Revenue − goods − payroll − till. Null the moment any term is missing. */
  netProfitIdr: number | null;
}

/**
 * Cross-depot comparison over a window (design 14d).
 *
 * The three columns beyond orders/revenue used to be `value: () => null` in the CLIENT,
 * with a comment saying order-service could not join them. It still cannot — so it asks
 * the three services that own them, per depot, the same way the monthly review does. A
 * comparison screen where three of five rows are permanently "—" is a screen nobody opens.
 */
export interface DepotCompareReport extends ReportRangeView {
  depots: DepotCompareRow[];
}

/**
 * Depot "Tinjauan ops bulanan" composite for the monthly review screen. orders/revenue/
 * activeCustomers are real order-service figures; SLA is read from delivery-service and
 * netProfit is still null (see the field); topCourier is derived from the order's own
 * driverName (delivered count, no rating).
 */
export interface DepotMonthlyReport {
  depotId: string;
  /** Reported month, 'YYYY-MM'. */
  month: string;
  orders: number;
  revenueIdr: number;
  /** Distinct customers with a non-cancelled order in the month. */
  activeCustomers: number;
  /**
   * Revenue − goods − payroll − operating cost, whole rupiah.
   *
   * **Null when ANY input is missing**, never a partial subtraction: a profit computed from
   * a payroll nobody could fetch is not a small error, it is the wrong number with a
   * confident face. `profitBreakdown` carries the four terms so the screen can show the
   * arithmetic rather than assert a conclusion.
   */
  netProfitIdr: number | null;
  /**
   * The terms behind `netProfitIdr`, each null when its owning service could not be read.
   *
   * Present even when the net is null — knowing WHICH half failed is what turns "—" from a
   * dead end into something an operator can chase. `cogsIdr` is purchases received in the
   * month, not accrual cost of goods sold: the catalog has no per-unit cost price, and the
   * screen labels it as such rather than implying an accounting nobody performed.
   */
  profitBreakdown: DepotCostBreakdown & { revenueIdr: number };
  /**
   * On-time delivery share for the month, 0..100 with one decimal. Null when
   * delivery-service could not be read, or when nothing was delivered — a rate of 0 there
   * would describe a depot in crisis rather than a quiet month.
   */
  slaPct: number | null;
  // Depot SOP: the monthly review is read in GALLONS, against last month.
  /** Gallons delivered this month. */
  gallons: number;
  /** The same figure for the month before, which is what the SOP compares against. */
  prevGallons: number;
  /** gallons − prevGallons; negative when the depot sold less. */
  gallonsDelta: number;
  /** Percent change vs last month, or null when last month was 0 (no denominator). */
  growthPct: number | null;
  /** Gallons per elapsed day of the month — not per 30, which flatters a short month. */
  avgGallonsPerDay: number;
  topCourier?: { name: string; delivered: number };
  /**
   * The governance panel: approvals reviewed, stock-count variance, settlement variance.
   *
   * NULL means depot-service could not be read — not a clean month. The three used to be
   * literal '—' strings in the client, which is indistinguishable from a depot that never
   * closed its books.
   */
  governance: DepotGovernanceFigures | null;
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

/** One reseller's monthly rollup (design: reseller achievement). All figures are gallons. */
export interface ResellerRollupRow {
  customerId: string;
  volumeQty: number;
  prevVolumeQty: number;
  orderCount: number;
  lastOrderAt: string | null;
}

export interface ResellerRollupReport {
  depotId: string;
  /** Reported month, 'YYYY-MM'. */
  month: string;
  rows: ResellerRollupRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Gallon count off the line's snapshotted `isGallon` flag. Previously a /galon/i
 * test over the unit label and product name — the flag makes the answer stable
 * against catalog copy edits, and identical for historical rows (backfilled with
 * the union of both old predicates in 20260802120000_meter_reading).
 */
export function gallonQty(order: OrderRecord): number {
  return order.items.reduce((s, i) => s + (i.isGallon ? i.quantity : 0), 0);
}
// Exported so the meter reconciliation counts a day exactly the way depotDaily does.
// Two copies of "what counts as delivered" would drift, and the whole point of the
// reconciliation is that its sales side matches the daily report's.
export const isDelivered = (s: OrderStatus): boolean =>
  s === OrderStatus.DELIVERED || s === OrderStatus.COMPLETED;

/** Sales/customer/depot aggregates over the order book (PRD Module 13, FR-095..098). */
@Injectable()
export class ReportService {
  private static readonly MAX_LIMIT = 100;
  /**
   * Ceiling on one segment resolution. A broadcast audience is a list of people, not a
   * report page, so this is sized for a real campaign rather than a screen — but it is
   * still a ceiling, because "every customer we have ever had" must not arrive as one
   * response body. Crossing it is reported, never silently trimmed.
   */
  private static readonly MAX_SEGMENT_CUSTOMERS = 5000;
  /**
   * Rows per scheduled export. A report is a spreadsheet somebody reads, not a data dump —
   * and the aggregates behind it are already top-N, so this is the N.
   */
  private static readonly EXPORT_ROWS = 100;
  private readonly logger = new Logger(ReportService.name);

  constructor(
    @Inject(ORDER_TOKENS.OrderRepository) private readonly orders: OrderRepository,
    private readonly config: OrderConfigService,
    // Optional so every existing test double that builds a ReportService with two args
    // keeps compiling; the broadcast simply does nothing without them.
    @Optional()
    @Inject(ORDER_TOKENS.DepotDirectory)
    private readonly depotDirectory?: DepotDirectoryPort,
    @Optional()
    @Inject(ORDER_TOKENS.Notification)
    private readonly notifications?: NotificationPort,
    @Optional()
    @Inject(ORDER_TOKENS.PaymentCash)
    private readonly paymentCash?: PaymentCashPort,
    @Optional()
    @Inject(ORDER_TOKENS.DeliverySla)
    private readonly deliverySla?: DeliverySlaPort,
    @Optional()
    @Inject(ORDER_TOKENS.DepotCosts)
    private readonly depotCosts?: DepotCostsPort,
  ) {}

  async sales(granularity: 'daily' | 'monthly', range: ReportRange): Promise<SalesReport> {
    const buckets = await this.orders.salesSeries(granularity, range, this.config.businessTimeZone);
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

  /**
   * One depot's customer ratings for the ratings screen (design 14b): average, review
   * count, star distribution, and recent review cards — all real order-review data.
   */
  async depotRatings(depotId: string, range: ReportRange): Promise<DepotRatingsReport> {
    const d = await this.orders.depotRatings(depotId, range);
    return {
      depotId,
      ...ReportService.rangeView(range),
      average: d.average === null ? null : Math.round(d.average * 10) / 10,
      count: d.count,
      distribution: d.distribution,
      recent: d.recent.map((r) => ({
        customerName: r.customerName,
        stars: r.stars,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    };
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
    const cells = await this.orders.retentionCohort(range, this.config.businessTimeZone);
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
  }): Promise<{
    count: number;
    recencyDays: number | null;
    minOrders: number | null;
    depotId: string | null;
  }> {
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

  /**
   * The customers behind `segmentEstimate`, for crm to broadcast to. Same conditions, same
   * day arithmetic — the two are deliberately one code path apart so a screen cannot size
   * an audience one way and message a different one.
   *
   * `truncated` is the point of the cap: an audience larger than MAX_SEGMENT_CUSTOMERS is
   * reported as cut off rather than returned short, so the caller can refuse instead of
   * reaching part of a segment and calling it sent.
   */
  async segmentCustomers(
    input: {
      recencyDays?: number;
      lapsedDays?: number;
      newWithinDays?: number;
      minOrders?: number;
      depotId?: string;
    },
    limit = ReportService.MAX_SEGMENT_CUSTOMERS,
  ): Promise<{ customerIds: string[]; truncated: boolean }> {
    const daysAgo = (d: number): Date => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const customerIds = await this.orders.segmentCustomerIds(
      {
        recencyCutoff: input.recencyDays != null ? daysAgo(input.recencyDays) : undefined,
        lapsedCutoff: input.lapsedDays != null ? daysAgo(input.lapsedDays) : undefined,
        firstOrderCutoff: input.newWithinDays != null ? daysAgo(input.newWithinDays) : undefined,
        minOrders: input.minOrders,
        depotId: input.depotId,
      },
      limit,
    );
    return { customerIds, truncated: customerIds.length >= limit };
  }

  /**
   * The rows behind a scheduled revenue report (design 15c), for admin-service's sweep.
   *
   * Same two aggregates the HQ export screen already draws, flattened to one label/orders/
   * revenue shape so a spreadsheet does not need to know which grouping produced it. Depot
   * rows are labelled with the depot's NAME when depot-service can be reached; a UUID in a
   * report somebody opens next quarter is not a label, but it is better than no report, so
   * the id is the fallback rather than a failure.
   */
  async exportRows(
    dataset: 'REVENUE_BY_DEPOT' | 'REVENUE_BY_PRODUCT',
    range: ReportRange,
  ): Promise<{ rows: { label: string; orders: number; revenue: number }[]; truncated: boolean }> {
    /*
     * E-4: `truncated`, like `segmentCustomers` above already reports. EXPORT_ROWS is 100
     * and nothing said so: a network past its 100th depot handed finance a spreadsheet that
     * simply stopped, with no row, header or flag to say the rest existed. A short answer
     * and a cut-off answer look identical in a spreadsheet, and only one of them is a fact.
     */
    if (dataset === 'REVENUE_BY_PRODUCT') {
      const report = await this.revenueByProduct(range, ReportService.EXPORT_ROWS);
      return {
        rows: report.items.map((i) => ({
          label: i.productName,
          orders: i.orderCount,
          revenue: i.revenue,
        })),
        truncated: report.items.length >= ReportService.EXPORT_ROWS,
      };
    }
    const { items } = await this.topDepots(range, ReportService.EXPORT_ROWS);
    const contacts = (await this.depotDirectory?.listContacts()) ?? null;
    const names = new Map((contacts ?? []).map((d) => [d.id, d.name]));
    return {
      rows: items.map((i) => ({
        label: names.get(i.depotId) ?? i.depotId,
        orders: i.orderCount,
        revenue: i.revenue,
      })),
      truncated: items.length >= ReportService.EXPORT_ROWS,
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
  /**
   * The one definition of "a depot's day", shared by the report and its export (K-2).
   *
   * H-16: `${date}T00:00:00.000Z` is 07:00 WIB. A depot's "daily" report therefore started
   * mid-morning and swallowed seven hours of the day before — which is why the daily card
   * and the meter reconciliation could disagree about the same date. "Today" with no date
   * given is the WIB today for the same reason: before 07:00 WIB those are different days,
   * and the operator asking is in WIB.
   *
   * Private and shared rather than copied, because the export's own doc already promised
   * it "reads the exact window depotDaily reads" while quietly reading a different one.
   */
  private dayWindow(date?: string): { day: string; from: Date; to: Date } {
    const tz = this.config.businessTimeZone;
    const day = date ?? localDayKey(new Date(), tz);
    const from = dayStartUtc(day, tz);
    return { day, from, to: addLocalDays(from, 1, tz) };
  }

  async depotDaily(depotId: string, date?: string): Promise<DepotDailyReport> {
    const { day, from, to } = this.dayWindow(date);
    const rows = await this.orders.ordersForDepot(depotId, { from, to });
    const live = rows.filter((r) => r.status !== OrderStatus.CANCELLED);
    const delivered = live.filter((r) => isDelivered(r.status));

    // Courier COD is asked for over the day's DELIVERY orders only. A counter sale's
    // payment is booked against the depot, and `depotCash` already counts it — asking for
    // both would put the same rupiah in two columns of the same report.
    const deliveryOrders = rows.filter((r) => r.isWalkIn !== true);
    const [cashRows, drawer, returns] = await Promise.all([
      deliveryOrders.length > 0 && this.paymentCash
        ? this.paymentCash.cashByOrder(deliveryOrders.map((r) => r.id))
        : Promise.resolve(this.paymentCash ? [] : null),
      this.paymentCash ? this.paymentCash.depotCash(depotId, from, to) : Promise.resolve(null),
      this.depotDirectory?.gallonReturns
        ? this.depotDirectory.gallonReturns(depotId, from, to)
        : Promise.resolve(null),
    ]);
    const cashBy = cashRows && new Map(cashRows.map((c) => [c.orderId, c.amountIdr]));

    return {
      depotId,
      date: day,
      orders: live.length,
      revenueIdr: Math.round(live.reduce((s, r) => s + r.total, 0)),
      gallonsDelivered: delivered.reduce((s, r) => s + gallonQty(r), 0),
      gallonsReturned: returns ? returns.gallons : null,
      gallonsDamaged: returns ? returns.damaged : null,
      codCollectedIdr: cashRows ? cashRows.reduce((s, c) => s + c.amountIdr, 0) : null,
      cashInDrawerIdr: drawer,
      failedDeliveries: rows.filter((r) => r.status === OrderStatus.CANCELLED).length,
      perCourier: ReportService.perCourier(rows, cashBy),
    };
  }

  /**
   * The day's orders grouped by the courier who carried them.
   *
   * Grouped on `driverName`, the only courier identity an order carries — the same key
   * `depotWeekly`/`reportsDepotMonthly` already use for `topCourier`, so the daily
   * breakdown and the weekly top-courier can never disagree about who did what. Two
   * couriers sharing a display name would merge; the fix for that is a driver id on the
   * order, not a second grouping rule here.
   *
   * `failed` is the cancelled orders that had already been assigned to that courier, which
   * is why cancelled rows are grouped too rather than filtered out first.
   */
  private static perCourier(
    rows: OrderRecord[],
    cashBy: Map<string, number> | null,
  ): DepotCourierDaily[] {
    const by = new Map<string, { completed: number; failed: number; codIdr: number }>();
    for (const o of rows) {
      if (!o.driverName) continue;
      const cur = by.get(o.driverName) ?? { completed: 0, failed: 0, codIdr: 0 };
      if (o.status === OrderStatus.CANCELLED) cur.failed += 1;
      else if (isDelivered(o.status)) cur.completed += 1;
      cur.codIdr += cashBy?.get(o.id) ?? 0;
      by.set(o.driverName, cur);
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, c]) => ({
        name,
        completed: c.completed,
        failed: c.failed,
        codIdr: cashBy ? c.codIdr : null,
      }));
  }

  /**
   * The same day, order by order, for the "Ekspor" button on the daily report.
   *
   * Rows, not totals: the totals are already on screen, and what an export is for is the
   * arithmetic behind them — which order, which courier, how much, and whether it was
   * cancelled. Cancelled rows are INCLUDED and marked, because an export that silently
   * drops them cannot be reconciled against anything.
   *
   * Reads the exact window `depotDaily` reads, from the same method, so the file and the
   * screen can never disagree about which orders belong to the day.
   */
  async depotDailyRows(depotId: string, date?: string): Promise<DepotDailyRow[]> {
    const { from, to } = this.dayWindow(date);
    const rows = await this.orders.ordersForDepot(depotId, { from, to });
    return rows
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => ({
        orderNumber: r.orderNumber,
        createdAt: r.createdAt.toISOString(),
        status: r.status,
        cancelled: r.status === OrderStatus.CANCELLED,
        recipientName: r.recipientName,
        driverName: r.driverName ?? null,
        gallons: gallonQty(r),
        subtotalIdr: Math.round(r.subtotal),
        deliveryFeeIdr: Math.round(r.deliveryFee),
        discountIdr: Math.round(r.discount),
        totalIdr: Math.round(r.total),
        isWalkIn: r.isWalkIn === true,
      }));
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
      const day = localDayKey(o.createdAt, this.config.businessTimeZone);
      byDay.set(day, (byDay.get(day) ?? 0) + o.total);
      for (const i of o.items)
        byProduct.set(i.productName, (byProduct.get(i.productName) ?? 0) + i.quantity);
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
    // The window has to be closed to ask anyone else about it: SLA, costs and returns are
    // all range reads. An open-ended compare keeps the two real columns and leaves the
    // other three null rather than quietly reporting one depot's whole history.
    const bounded = range.from != null && range.to != null;
    const from = range.from as Date;
    const to = range.to as Date;

    const depots = await Promise.all(
      depotIds.map(async (depotId) => {
        const [rows, onTime, costs, payrollIdr, returns] = await Promise.all([
          this.orders.ordersForDepot(depotId, range),
          bounded && this.deliverySla
            ? this.deliverySla.onTimeRate(depotId, from, to)
            : Promise.resolve(null),
          bounded && this.depotCosts ? this.depotCosts.costs(depotId, from, to) : Promise.resolve(null),
          bounded && this.depotCosts
            ? this.depotCosts.payroll(depotId, localDayKey(from, this.config.businessTimeZone).slice(0, 7))
            : Promise.resolve(null),
          bounded && this.depotDirectory?.gallonReturns
            ? this.depotDirectory.gallonReturns(depotId, from, to)
            : Promise.resolve(null),
        ]);
        const live = rows.filter((r) => r.status !== OrderStatus.CANCELLED);
        const revenueIdr = Math.round(live.reduce((s, r) => s + r.total, 0));
        return {
          depotId,
          orders: live.length,
          revenueIdr,
          slaPct: onTime === null ? null : Math.round(onTime * 1000) / 10,
          wastageGallons: returns ? returns.damaged : null,
          netProfitIdr: ReportService.netProfit(revenueIdr, {
            cogsIdr: costs ? costs.cogsIdr : null,
            opexIdr: costs ? costs.opexIdr : null,
            payrollIdr,
          }),
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
    const tz = this.config.businessTimeZone;
    const from = dayStartUtc(`${month}-01`, tz);
    const to = addLocalMonths(from, 1, tz);
    const prevFrom = addLocalMonths(from, -1, tz);
    // Last month is one more read of the same shape — the SOP reads the two side by side,
    // and a month of one depot's orders is far under the 20.000-row range bound.
    const [rows, prevRows, onTime, costs, payrollIdr, governance] = await Promise.all([
      this.orders.ordersForDepot(depotId, { from, to }),
      this.orders.ordersForDepot(depotId, { from: prevFrom, to: from }),
      // Measured in delivery-service, which is the only place that knows when a delivery
      // actually arrived. An order's status says it was delivered, never whether it was late.
      this.deliverySla ? this.deliverySla.onTimeRate(depotId, from, to) : Promise.resolve(null),
      this.depotCosts ? this.depotCosts.costs(depotId, from, to) : Promise.resolve(null),
      this.depotCosts ? this.depotCosts.payroll(depotId, month) : Promise.resolve(null),
      // Approvals, stock counts and the daily close all live in depot-service; one read.
      this.depotCosts ? this.depotCosts.governance(depotId, from, to) : Promise.resolve(null),
    ]);
    const live = rows.filter((r) => r.status !== OrderStatus.CANCELLED);
    const byCourier = new Map<string, number>();
    for (const o of live) {
      if (isDelivered(o.status) && o.driverName)
        byCourier.set(o.driverName, (byCourier.get(o.driverName) ?? 0) + 1);
    }
    const top = [...byCourier.entries()].sort((a, b) => b[1] - a[1])[0];

    // Gallons count only what was actually DELIVERED, the same rule the daily report and
    // the reseller rollup use — a galon still on the truck has not been sold to anyone.
    const gallonsOf = (rs: typeof rows): number =>
      rs.filter((r) => isDelivered(r.status)).reduce((sum, r) => sum + gallonQty(r), 0);
    const gallons = gallonsOf(rows);
    const prevGallons = gallonsOf(prevRows);
    const revenueIdr = Math.round(live.reduce((s, r) => s + r.total, 0));
    const breakdown: DepotCostBreakdown = {
      cogsIdr: costs ? costs.cogsIdr : null,
      opexIdr: costs ? costs.opexIdr : null,
      payrollIdr,
    };

    return {
      depotId,
      month,
      orders: live.length,
      revenueIdr,
      activeCustomers: new Set(live.map((r) => r.customerId)).size,
      netProfitIdr: ReportService.netProfit(revenueIdr, breakdown),
      profitBreakdown: { revenueIdr, ...breakdown },
      // Percent, to one decimal — the screen prints a percentage, and rounding to whole
      // points turns 87,6% into 88% right at the band the HQ dashboard reacts to.
      slaPct: onTime === null ? null : Math.round(onTime * 1000) / 10,
      gallons,
      prevGallons,
      gallonsDelta: gallons - prevGallons,
      // Null, not 0 and not Infinity: with nothing to grow from there is no percentage to
      // report, and "+100%" off a zero base is a number somebody would act on.
      growthPct:
        prevGallons > 0 ? Math.round(((gallons - prevGallons) / prevGallons) * 100) : null,
      avgGallonsPerDay: Math.round(gallons / ReportService.elapsedDays(from, to)),
      governance,
      ...(top ? { topCourier: { name: top[0], delivered: top[1] } } : {}),
    };
  }

  /**
   * Revenue minus every cost term — or null the moment one term is missing.
   *
   * **Fail-closed on purpose.** Treating an unreachable hr-service as "payroll was zero"
   * would publish a profit inflated by the depot's entire wage bill, and it would look
   * exactly like a good month. The screen showing "—" next to a breakdown that names the
   * missing half is the honest version of not knowing.
   *
   * `cogsIdr` is purchases RECEIVED in the month, not accrual cost of goods sold — the
   * catalog carries no per-unit cost price, so a month with one big delivery reads as a
   * thin month. The breakdown is what lets a reader see that rather than be misled by it.
   */
  private static netProfit(revenueIdr: number, costs: DepotCostBreakdown): number | null {
    const terms = [costs.cogsIdr, costs.payrollIdr, costs.opexIdr];
    if (terms.some((t) => t === null)) return null;
    return terms.reduce((net: number, t) => net - (t as number), revenueIdr);
  }

  /**
   * Days of the month that have actually happened, for the per-day average.
   *
   * A finished month is its whole length; the CURRENT month is only as long as it has got
   * so far. Dividing this month's four days of sales by 31 reports a depot as collapsing
   * every time somebody opens the review early in the month.
   */
  private static elapsedDays(from: Date, to: Date): number {
    const now = new Date();
    const end = now < to ? now : to;
    // A day in progress counts (ceil): four and a half days in is day five, not day four.
    // Floor at 1 so a month that has not started yet averages 0 rather than dividing by 0.
    return Math.max(1, Math.ceil((end.getTime() - from.getTime()) / DAY_MS));
  }

  /**
   * Depot SOP: the twice-daily "laporan penjualan siang/sore" — how many gallons each
   * depot has delivered so far today, sent to the depot itself.
   *
   * Addressed to `contactPhone`, falling back to the HQ ops number so a depot that has
   * not filled its number in is still reported rather than silently skipped.
   *
   * NOT idempotent, on purpose: there is no table to record a send in, and `sweep.sh`
   * already holds a per-job lock, so a double send needs a manual run. The message is
   * informational, not a transaction — inventing a dedupe table for it would be the more
   * expensive mistake. Failures are per depot: one unreachable number must not stop the
   * rest of the round.
   *
   * The count is `attempted`, NOT `sent`. `NotificationPort` is fail-open by contract — its
   * adapter logs a crm outage and returns void — so this layer cannot know a message
   * actually left the building, and a cron line reading "sent 12" while WhatsApp was down
   * is the kind of false all-clear that keeps an outage quiet for a week.
   */
  async broadcastDailySales(
    slot: 'siang' | 'sore',
  ): Promise<{ attempted: number; skipped: number }> {
    if (!this.depotDirectory || !this.notifications) return { attempted: 0, skipped: 0 };
    const contacts = await this.depotDirectory.listContacts();
    if (!contacts) return { attempted: 0, skipped: 0 };

    const today = localDayKey(new Date(), this.config.businessTimeZone);
    const fallback = this.config.alertPhone;
    let attempted = 0;
    let skipped = 0;
    for (const depot of contacts) {
      const phone = depot.contactPhone || fallback;
      if (!phone) {
        skipped++;
        continue;
      }
      try {
        const days = await this.depotDailyGallons(depot.id, today, today);
        const gallons = days.reduce((sum, d) => sum + d.gallons, 0);
        await this.notifications.notify(
          'DEPOT_SALES_UPDATE',
          phone,
          { slot, depot: depot.name, gallons: String(gallons) },
          null,
          '',
        );
        attempted++;
      } catch (error) {
        // One depot's failure is its own; the round continues. In practice this catches the
        // gallon query, not the notify — see the note above.
        this.logger.warn(
          `Daily sales update skipped for ${depot.id}: ${(error as Error).message}`,
        );
        skipped++;
      }
    }
    return { attempted, skipped };
  }

  /**
   * Gallons delivered per local day, for hr-service's daily sales bonus (depot SOP).
   *
   * `fromDay`/`toDay` are inclusive 'YYYY-MM-DD' LOCAL day keys, matching the way
   * `Attendance.workDate` is stored — the bonus is paid per attended day, so the two must
   * cut the day at the same instant. Bucketing happens in SQL, in the same time zone.
   */
  async depotDailyGallons(
    depotId: string,
    fromDay: string,
    toDay: string,
  ): Promise<{ day: string; gallons: number }[]> {
    const tz = this.config.businessTimeZone;
    const from = dayStartUtc(fromDay, tz);
    const to = addLocalDays(dayStartUtc(toDay, tz), 1, tz);
    return this.orders.depotDailyGallons(depotId, from, to, tz);
  }

  /**
   * Per-reseller monthly achievement (design: reseller evaluation). For the requested
   * customerIds within one depot: delivered gallon volume this month + previous month
   * (drives growth), delivered order count, and the last delivered order time. Read-time
   * only — no stored actuals. Empty customerIds short-circuits to no rows.
   */
  async resellerRollup(
    depotId: string,
    month: string,
    customerIds: string[],
  ): Promise<ResellerRollupReport> {
    if (customerIds.length === 0) return { depotId, month, rows: [] };
    const wanted = new Set(customerIds);

    const tz = this.config.businessTimeZone;
    const from = dayStartUtc(`${month}-01`, tz);
    const to = addLocalMonths(from, 1, tz);
    const prevFrom = addLocalMonths(from, -1, tz);

    const [thisRows, prevRows] = await Promise.all([
      this.orders.ordersForDepot(depotId, { from, to }),
      this.orders.ordersForDepot(depotId, { from: prevFrom, to: from }),
    ]);

    const delivered = (rows: typeof thisRows) =>
      rows.filter((o) => wanted.has(o.customerId) && isDelivered(o.status));

    const prevVol = new Map<string, number>();
    for (const o of delivered(prevRows)) {
      prevVol.set(o.customerId, (prevVol.get(o.customerId) ?? 0) + gallonQty(o));
    }

    const agg = new Map<
      string,
      { volumeQty: number; orderCount: number; lastOrderAt: Date | null }
    >();
    for (const o of delivered(thisRows)) {
      const cur = agg.get(o.customerId) ?? { volumeQty: 0, orderCount: 0, lastOrderAt: null };
      cur.volumeQty += gallonQty(o);
      cur.orderCount += 1;
      if (!cur.lastOrderAt || o.createdAt > cur.lastOrderAt) cur.lastOrderAt = o.createdAt;
      agg.set(o.customerId, cur);
    }

    const rows: ResellerRollupRow[] = customerIds.map((customerId) => {
      const a = agg.get(customerId);
      return {
        customerId,
        volumeQty: a?.volumeQty ?? 0,
        prevVolumeQty: prevVol.get(customerId) ?? 0,
        orderCount: a?.orderCount ?? 0,
        lastOrderAt: a?.lastOrderAt ? a.lastOrderAt.toISOString() : null,
      };
    });

    return { depotId, month, rows };
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
