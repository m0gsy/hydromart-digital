import { Inject, Injectable } from '@nestjs/common';

import {
  CustomerSales,
  DepotSales,
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
