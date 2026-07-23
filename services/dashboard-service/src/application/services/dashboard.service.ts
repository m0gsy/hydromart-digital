import { Inject, Injectable } from '@nestjs/common';

import {
  DashboardSourcesPort,
  DateRange,
  DeliverySla,
  DepotOperationalCosts,
  LowStockLine,
  SalesReport,
  TopCustomers,
  TopDepots,
} from '../ports/dashboard-sources.port';

export interface NetworkDepotRow {
  depotId: string;
  code: string;
  name: string;
  active: boolean;
  ownershipType: string;
  revenue: number;
  orderCount: number;
  /** On-time rate 0..1, or null when the depot has no delivered orders in range. */
  slaRate: number | null;
  /** Average delivered-order lead time in minutes, or null when none delivered. */
  avgMinutes: number | null;
  /** Average customer rating 1..5, or null when the depot has no reviews in range. */
  rating: number | null;
  lowStockCount: number;
}

export interface NetworkDashboard {
  from: string | null;
  to: string | null;
  depots: NetworkDepotRow[];
  sources: {
    depot: 'ok' | 'unavailable';
    order: 'ok' | 'unavailable';
    delivery: 'ok' | 'unavailable';
    inventory: 'ok' | 'unavailable';
  };
}
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

export interface MonthlyOperationalPnl {
  depotId: string;
  month: string;
  from: string;
  to: string;
  reportType: 'OPERATIONAL_MANAGEMENT';
  disclaimer: string;
  revenueIdr: number | null;
  cogsIdr: number | null;
  coveredCogsIdr: number | null;
  opexIdr: number | null;
  grossProfitIdr: number | null;
  netOperatingProfitIdr: number | null;
  marginPct: number | null;
  costCoverage: DepotOperationalCosts['cogs'] | null;
  opexCoverage: DepotOperationalCosts['opex'] | null;
  sources: {
    order: 'ok' | 'unavailable';
    depot: 'ok' | 'partial' | 'unavailable';
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
  // Network roll-up lists every depot; keep the revenue report wide enough that
  // no live depot falls outside it and reads a false 0.
  private static readonly NETWORK_TOP_LIMIT = 100;

  constructor(
    @Inject(DASHBOARD_TOKENS.Sources) private readonly sources: DashboardSourcesPort,
  ) {}

  async monthlyPnl(depotId: string, month: string, token: string): Promise<MonthlyOperationalPnl> {
    const fromDate = new Date(`${month}-01T00:00:00.000Z`);
    const toDate = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + 1, 1));
    const range = { from: fromDate.toISOString(), to: toDate.toISOString() };
    const [order, costs] = await Promise.all([
      this.sources.depotMonthly(depotId, month, token),
      this.sources.operationalCosts(depotId, range, token),
    ]);

    const revenueIdr = order?.revenueIdr ?? null;
    const cogsIdr = costs?.cogs.amountIdr ?? null;
    const opexIdr = costs?.opex.amountIdr ?? null;
    const grossProfitIdr =
      revenueIdr !== null && cogsIdr !== null ? revenueIdr - cogsIdr : null;
    const netOperatingProfitIdr =
      grossProfitIdr !== null && opexIdr !== null ? grossProfitIdr - opexIdr : null;
    const marginPct =
      netOperatingProfitIdr !== null && revenueIdr !== null && revenueIdr !== 0
        ? Math.round((netOperatingProfitIdr / revenueIdr) * 1000) / 10
        : null;

    return {
      depotId,
      month,
      ...range,
      reportType: 'OPERATIONAL_MANAGEMENT',
      disclaimer:
        costs?.disclaimer ??
        'Operational management report only; not statutory accounting or a tax statement.',
      revenueIdr,
      cogsIdr,
      coveredCogsIdr: costs?.cogs.coveredAmountIdr ?? null,
      opexIdr,
      grossProfitIdr,
      netOperatingProfitIdr,
      marginPct,
      costCoverage: costs?.cogs ?? null,
      opexCoverage: costs?.opex ?? null,
      sources: {
        order: order === null ? 'unavailable' : 'ok',
        depot:
          costs === null
            ? 'unavailable'
            : costs.cogs.status === 'partial' || costs.opex.status === 'partial'
              ? 'partial'
              : 'ok',
      },
    };
  }

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
   * HQ network roll-up: one row per depot in the network with revenue + orders
   * (order-service top-depots), on-time SLA (delivery-service sla-by-depot), and
   * low-stock count (depot-service low-stock, fanned out per depot). Assembled
   * best-effort — a down source marks itself 'unavailable' and its columns read
   * as 0/null rather than failing the whole response (same pattern as executive).
   */
  async network(range: DateRange, token: string): Promise<NetworkDashboard> {
    const [depots, topDepots, slaByDepot, ratingByDepot] = await Promise.all([
      this.sources.allDepots(token),
      this.sources.topDepots(range, DashboardService.NETWORK_TOP_LIMIT, token),
      this.sources.slaByDepot(range, token),
      this.sources.ratingByDepot(range, token),
    ]);

    const revenueByDepot = new Map<string, { orderCount: number; revenue: number }>();
    for (const item of topDepots?.items ?? []) {
      revenueByDepot.set(item.depotId, { orderCount: item.orderCount, revenue: item.revenue });
    }
    const slaByDepotId = new Map<string, number>();
    const avgMinutesByDepot = new Map<string, number | null>();
    for (const row of slaByDepot?.depots ?? []) {
      slaByDepotId.set(row.depotId, row.slaRate);
      avgMinutesByDepot.set(row.depotId, row.avgMinutes);
    }
    const ratingByDepotId = new Map<string, number>();
    for (const row of ratingByDepot?.items ?? []) {
      ratingByDepotId.set(row.depotId, row.rating);
    }

    // Low-stock fan-out per depot (same shape as franchise()).
    const lowStockLists: (LowStockLine[] | null)[] = depots
      ? await Promise.all(depots.map((d) => this.sources.lowStock(d.id, token)))
      : [];
    let inventoryOk = depots !== null;

    const rows: NetworkDepotRow[] = (depots ?? []).map((d, i) => {
      const rev = revenueByDepot.get(d.id);
      const low = lowStockLists[i];
      if (low === null) inventoryOk = false;
      return {
        depotId: d.id,
        code: d.code,
        name: d.name,
        active: d.active,
        ownershipType: d.ownershipType,
        revenue: rev?.revenue ?? 0,
        orderCount: rev?.orderCount ?? 0,
        slaRate: slaByDepotId.has(d.id) ? slaByDepotId.get(d.id)! : null,
        avgMinutes: avgMinutesByDepot.has(d.id) ? avgMinutesByDepot.get(d.id)! : null,
        rating: ratingByDepotId.has(d.id) ? ratingByDepotId.get(d.id)! : null,
        lowStockCount: low?.length ?? 0,
      };
    });

    return {
      from: range.from ?? null,
      to: range.to ?? null,
      depots: rows,
      sources: {
        depot: depots !== null ? 'ok' : 'unavailable',
        order: topDepots !== null ? 'ok' : 'unavailable',
        delivery: slaByDepot !== null ? 'ok' : 'unavailable',
        inventory: inventoryOk ? 'ok' : 'unavailable',
      },
    };
  }

  /**
   * Franchise-owner dashboard (M-R3.2): scopes revenue + low-stock to the depots
   * the caller owns. Fans out to depot-service (/depots/mine) and order-service
   * (top-depots) + delivery-service (SLA scoped to the owned depots via ?depotIds=),
   * then rolls up low-stock per owned depot. Best-effort per section like the
   * executive BFF.
   */
  async franchise(range: DateRange, token: string): Promise<FranchiseDashboard> {
    // Owner's depots + global-ish top-depots first; both feed the per-depot rollup.
    const [depots, topDepots] = await Promise.all([
      this.sources.myDepots(token),
      this.sources.topDepots(range, DashboardService.FRANCHISE_TOP_LIMIT, token),
    ]);

    const revenueByDepot = new Map<string, { orderCount: number; revenue: number }>();
    for (const item of topDepots?.items ?? []) {
      revenueByDepot.set(item.depotId, { orderCount: item.orderCount, revenue: item.revenue });
    }

    // SLA scoped to the owner's depots + low-stock rollup, once depot ids are known.
    // SLA needs ≥1 depot to scope (empty depotIds would read as global) — null when
    // the directory is down or the owner has no depots. Null calls mark their source
    // 'unavailable' but never fail the whole response.
    const depotIds = (depots ?? []).map((d) => d.id);
    const deliverySlaP =
      depotIds.length > 0 ? this.sources.deliverySla(range, token, depotIds) : Promise.resolve(null);
    const lowStockP: Promise<(LowStockLine[] | null)[]> = depots
      ? Promise.all(depots.map((d) => this.sources.lowStock(d.id, token)))
      : Promise.resolve([]);
    const [deliverySla, lowStockLists] = await Promise.all([deliverySlaP, lowStockP]);
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
