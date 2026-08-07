import { Inject, Injectable } from '@nestjs/common';
import { AccountNameResolver, addLocalMonths, dayStartUtc } from '@hydromart/platform';

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
import { DashboardConfigService } from '../../config/dashboard-config.service';
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

/** Owner franchise HR roll-up across owned depots (Fase 5). */
export interface FranchiseHr {
  lateToday: number;
  absentToday: number;
  presentToday: number;
  payrollMtdNet: number;
  activeHeadcount: number;
}

/** Owner franchise CRM roll-up across owned depots (Fase 5). */
export interface FranchiseCrm {
  baru: number;
  aktif: number;
  inactive: number;
  total: number;
  followUpCount: number;
  /** Customer-weighted repeat rate across depots, 0..100. */
  repeatRatePct: number;
}

export interface FranchiseDashboard {
  from: string | null;
  to: string | null;
  depots: FranchiseDepotSummary[];
  totals: { depotCount: number; revenue: number; orderCount: number; lowStockCount: number };
  deliverySla: DeliverySla | null;
  hr: FranchiseHr | null;
  crm: FranchiseCrm | null;
  sources: {
    depot: 'ok' | 'unavailable';
    order: 'ok' | 'unavailable';
    delivery: 'ok' | 'unavailable';
    inventory: 'ok' | 'unavailable';
    hr: 'ok' | 'unavailable';
    crm: 'ok' | 'unavailable';
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
    private readonly config: DashboardConfigService,
    @Inject(DASHBOARD_TOKENS.AccountNames) private readonly accountNames: AccountNameResolver,
  ) {}

  async monthlyPnl(depotId: string, month: string, token: string): Promise<MonthlyOperationalPnl> {
    // H-16: `${month}-01T00:00Z` is 07:00 WIB on the 1st, so the P&L window started
    // seven hours late and ended seven hours late — the first and last day of every
    // month were both partly wrong.
    const tz = this.config.businessTimeZone;
    const fromDate = dayStartUtc(`${month}-01`, tz);
    const toDate = addLocalMonths(fromDate, 1, tz);
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

    // §G-3. The card next to this one lists depots by name; this one listed its customers
    // as the first eight characters of a UUID. Fail-soft: no name changes nothing else.
    if (topCustomers) {
      const names = await this.accountNames(topCustomers.items.map((i) => i.customerId));
      topCustomers.items = topCustomers.items.map((i) => ({
        ...i,
        customerName: names.get(i.customerId) ?? null,
      }));
    }

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
    // One call per source for the whole set of owned depots, not one per depot (audit
    // S-1): an owner with 12 depots used to open this page with 36 HTTP requests.
    // Still best-effort per source — a null keeps that section 'unavailable' and the rest
    // of the dashboard renders.
    const lowStockP: Promise<(LowStockLine[] | null)[]> = depots
      ? this.sources
          .lowStockMany(depotIds, token)
          .then((byDepot) => depotIds.map((id) => byDepot?.get(id) ?? null))
      : Promise.resolve([]);
    // HR + CRM per-depot summaries (Fase 5) — internal-key batch, best-effort per depot.
    const hrP = this.sources.hrSummaryMany(depotIds);
    const crmP = this.sources.crmSummaryMany(depotIds);
    const [deliverySla, lowStockLists, hrList, crmList] = await Promise.all([
      deliverySlaP,
      lowStockP,
      hrP,
      crmP,
    ]);
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

    // HR roll-up: sum across depots. 'ok' only when at least one depot summary came back.
    const hrRows = hrList.filter((h): h is NonNullable<typeof h> => h !== null);
    const hr: FranchiseHr | null =
      depotIds.length > 0 && hrRows.length > 0
        ? hrRows.reduce(
            (acc, h) => ({
              lateToday: acc.lateToday + h.lateToday,
              absentToday: acc.absentToday + h.absentToday,
              presentToday: acc.presentToday + h.presentToday,
              payrollMtdNet: acc.payrollMtdNet + h.payrollMtdNet,
              activeHeadcount: acc.activeHeadcount + h.activeHeadcount,
            }),
            { lateToday: 0, absentToday: 0, presentToday: 0, payrollMtdNet: 0, activeHeadcount: 0 },
          )
        : null;

    // CRM roll-up: sum segment counts; repeat rate is customer-weighted across depots.
    const crmRows = crmList.filter((c): c is NonNullable<typeof c> => c !== null);
    let crm: FranchiseCrm | null = null;
    if (depotIds.length > 0 && crmRows.length > 0) {
      const acc = { baru: 0, aktif: 0, inactive: 0, total: 0, followUpCount: 0, repeatCustomers: 0 };
      for (const c of crmRows) {
        acc.baru += c.counts.baru;
        acc.aktif += c.counts.aktif;
        acc.inactive += c.counts.inactive;
        acc.total += c.counts.total;
        acc.followUpCount += c.followUps.length;
        acc.repeatCustomers += Math.round((c.repeatRatePct / 100) * c.counts.total);
      }
      crm = {
        baru: acc.baru,
        aktif: acc.aktif,
        inactive: acc.inactive,
        total: acc.total,
        followUpCount: acc.followUpCount,
        repeatRatePct: acc.total > 0 ? Math.round((acc.repeatCustomers / acc.total) * 100) : 0,
      };
    }

    return {
      from: range.from ?? null,
      to: range.to ?? null,
      depots: summaries,
      totals,
      deliverySla,
      hr,
      crm,
      sources: {
        depot: depots !== null ? 'ok' : 'unavailable',
        order: topDepots !== null ? 'ok' : 'unavailable',
        delivery: deliverySla !== null ? 'ok' : 'unavailable',
        inventory: inventoryOk ? 'ok' : 'unavailable',
        hr: hr !== null ? 'ok' : 'unavailable',
        crm: crm !== null ? 'ok' : 'unavailable',
      },
    };
  }
}
