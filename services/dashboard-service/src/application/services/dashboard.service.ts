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

export interface FranchiseDepotSummary {
  depotId: string;
  code: string;
  name: string;
  active: boolean;
  orderCount: number;
  revenue: number;
  lowStockCount: number;
}

export interface FranchiseDashboard {
  from: string | null;
  to: string | null;
  depots: FranchiseDepotSummary[];
  totals: { depotCount: number; revenue: number; orderCount: number; lowStockCount: number };
  deliverySla: DeliverySla | null;
  sources: {
    depot: 'ok' | 'unavailable';
    order: 'ok' | 'unavailable';
    delivery: 'ok' | 'unavailable';
    inventory: 'ok' | 'unavailable';
  };
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
  // Franchise scoping intersects the owner's depots with the top-depots report;
  // a high limit keeps depots outside the global top-10 from silently reading 0.
  private static readonly FRANCHISE_TOP_LIMIT = 100;

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

  /**
   * Franchise-owner dashboard (M-R3.2): scopes revenue + low-stock to the depots
   * the caller owns. Fans out to depot-service (/depots/mine) and order-service
   * (top-depots) + delivery-service (SLA, still global), then rolls up low-stock
   * per owned depot. Best-effort per section like the executive BFF.
   *
   * ponytail: delivery SLA is global, not per-franchise — no depot-scoped SLA
   * report exists yet; add a ?depotIds= filter on the SLA report when needed.
   */
  async franchise(range: DateRange, token: string): Promise<FranchiseDashboard> {
    const [depots, topDepots, deliverySla] = await Promise.all([
      this.sources.myDepots(token),
      this.sources.topDepots(range, DashboardService.FRANCHISE_TOP_LIMIT, token),
      this.sources.deliverySla(range, token),
    ]);

    const revenueByDepot = new Map<string, { orderCount: number; revenue: number }>();
    for (const item of topDepots?.items ?? []) {
      revenueByDepot.set(item.depotId, { orderCount: item.orderCount, revenue: item.revenue });
    }

    // Low-stock rollup, one call per owned depot. Null (a failed call) marks the
    // inventory source unavailable but never fails the whole response.
    const lowStockLists = depots
      ? await Promise.all(depots.map((d) => this.sources.lowStock(d.id, token)))
      : [];
    let inventoryOk = depots !== null;

    const summaries: FranchiseDepotSummary[] = (depots ?? []).map((d, i) => {
      const rev = revenueByDepot.get(d.id);
      const low = lowStockLists[i];
      if (low === null) inventoryOk = false;
      return {
        depotId: d.id,
        code: d.code,
        name: d.name,
        active: d.active,
        orderCount: rev?.orderCount ?? 0,
        revenue: rev?.revenue ?? 0,
        lowStockCount: low?.length ?? 0,
      };
    });

    const totals = summaries.reduce(
      (acc, s) => ({
        depotCount: acc.depotCount + 1,
        revenue: acc.revenue + s.revenue,
        orderCount: acc.orderCount + s.orderCount,
        lowStockCount: acc.lowStockCount + s.lowStockCount,
      }),
      { depotCount: 0, revenue: 0, orderCount: 0, lowStockCount: 0 },
    );

    return {
      from: range.from ?? null,
      to: range.to ?? null,
      depots: summaries,
      totals,
      deliverySla,
      sources: {
        depot: depots !== null ? 'ok' : 'unavailable',
        order: topDepots !== null ? 'ok' : 'unavailable',
        delivery: deliverySla !== null ? 'ok' : 'unavailable',
        inventory: inventoryOk ? 'ok' : 'unavailable',
      },
    };
  }
}
