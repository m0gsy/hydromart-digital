import { Inject, Injectable } from '@nestjs/common';

import {
  DashboardSourcesPort,
  DateRange,
  DeliverySla,
  SalesReport,
  TopCustomers,
  TopDepots,
} from '../ports/dashboard-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';

export interface ExecutiveDashboard {
  from: string | null;
  to: string | null;
  sales: SalesReport | null;
  topCustomers: TopCustomers | null;
  topDepots: TopDepots | null;
  deliverySla: DeliverySla | null;
  sources: { order: 'ok' | 'unavailable'; delivery: 'ok' | 'unavailable' };
}

/**
 * Executive dashboard BFF: fans out to order-service (sales, top customers,
 * top depots) and delivery-service (SLA) in parallel, forwarding the caller's
 * bearer token. Each source is best-effort — a null section marks its source
 * 'unavailable' instead of failing the whole response.
 */
@Injectable()
export class DashboardService {
  private static readonly TOP_LIMIT = 10;

  constructor(
    @Inject(DASHBOARD_TOKENS.Sources) private readonly sources: DashboardSourcesPort,
  ) {}

  async executive(range: DateRange, token: string): Promise<ExecutiveDashboard> {
    const [sales, topCustomers, topDepots, deliverySla] = await Promise.all([
      this.sources.sales(range, token),
      this.sources.topCustomers(range, DashboardService.TOP_LIMIT, token),
      this.sources.topDepots(range, DashboardService.TOP_LIMIT, token),
      this.sources.deliverySla(range, token),
    ]);

    const orderOk = sales !== null && topCustomers !== null && topDepots !== null;

    return {
      from: range.from ?? null,
      to: range.to ?? null,
      sales,
      topCustomers,
      topDepots,
      deliverySla,
      sources: {
        order: orderOk ? 'ok' : 'unavailable',
        delivery: deliverySla !== null ? 'ok' : 'unavailable',
      },
    };
  }
}
