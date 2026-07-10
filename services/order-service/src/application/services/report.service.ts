import { Inject, Injectable } from '@nestjs/common';

import {
  CustomerSales,
  DepotSales,
  OrderRepository,
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
