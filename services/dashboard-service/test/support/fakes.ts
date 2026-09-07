import {
  CrmDepotSummary,
  DashboardSourcesPort,
  DateRange,
  DeliverySla,
  DepotRatingByDepot,
  DepotMonthlyRevenue,
  DepotOperationalCosts,
  DepotSlaByDepot,
  FranchiseDepot,
  HrDepotSummary,
  LowStockLine,
  NetworkDepot,
  SalesReport,
  TopCustomers,
  TopDepots,
} from '../../src/application/ports/dashboard-sources.port';

const SALES: SalesReport = {
  granularity: 'monthly',
  from: null,
  to: null,
  buckets: [{ period: '2026-06', orderCount: 42, revenue: 1_260_000 }],
};

const TOP_CUSTOMERS: TopCustomers = {
  from: null,
  to: null,
  items: [{ customerId: 'cust-1', orderCount: 12, revenue: 360_000 }],
};

const TOP_DEPOTS: TopDepots = {
  from: null,
  to: null,
  items: [{ depotId: 'depot-1', orderCount: 30, revenue: 900_000, commissionBase: 850_000 }],
};

// depot-1 is in the top-depots report; depot-2 is not (reads 0 revenue).
const MY_DEPOTS: FranchiseDepot[] = [
  { id: 'depot-1', code: 'DPT-1', name: 'Depot One', active: true },
  { id: 'depot-2', code: 'DPT-2', name: 'Depot Two', active: false },
];

const LOW_STOCK: Record<string, LowStockLine[]> = {
  'depot-1': [{ itemId: 'item-1', depotId: 'depot-1' }],
  'depot-2': [],
};

// All depots incl. inactive (network roll-up). Mirrors MY_DEPOTS plus ownership.
const ALL_DEPOTS: NetworkDepot[] = [
  { id: 'depot-1', code: 'DPT-1', name: 'Depot One', active: true, ownershipType: 'PUSAT' },
  { id: 'depot-2', code: 'DPT-2', name: 'Depot Two', active: false, ownershipType: 'WARALABA' },
];

// depot-1 has a real SLA; depot-2 has none in range → null slaRate in the roll-up.
const SLA_BY_DEPOT: DepotSlaByDepot = {
  from: null,
  to: null,
  depots: [{ depotId: 'depot-1', slaRate: 0.9, avgMinutes: 32 }],
};

const RATING_BY_DEPOT: DepotRatingByDepot = {
  items: [{ depotId: 'depot-1', rating: 4.6, reviewCount: 12 }],
};

const DELIVERY_SLA: DeliverySla = {
  from: null,
  to: null,
  thresholdMinutes: 120,
  totalDelivered: 100,
  onTime: 92,
  breached: 8,
  slaRate: 0.92,
  avgMinutes: 74,
  failedCount: 3,
};

/**
 * In-memory DashboardSourcesPort with canned data. When `orderDown` is set,
 * the three order-service calls return null (delivery still responds), which
 * exercises the partial-availability path.
 */
export class InMemoryDashboardSources implements DashboardSourcesPort {
  constructor(private readonly orderDown = false) {}

  async sales(_range: DateRange, _token: string): Promise<SalesReport | null> {
    return this.orderDown ? null : SALES;
  }
  async topCustomers(_range: DateRange, _limit: number, _token: string): Promise<TopCustomers | null> {
    return this.orderDown ? null : TOP_CUSTOMERS;
  }
  async topDepots(_range: DateRange, _limit: number, _token: string): Promise<TopDepots | null> {
    return this.orderDown ? null : TOP_DEPOTS;
  }
  async deliverySla(
    _range: DateRange,
    _token: string,
    _depotIds?: string[],
  ): Promise<DeliverySla | null> {
    return DELIVERY_SLA;
  }
  async myDepots(_token: string): Promise<FranchiseDepot[] | null> {
    return this.orderDown ? null : MY_DEPOTS;
  }
  async lowStock(depotId: string, _token: string): Promise<LowStockLine[] | null> {
    return LOW_STOCK[depotId] ?? [];
  }
  // Counted by the S-1 test: the owner dashboard must reach depot-service ONCE for the
  // whole set, not once per depot.
  lowStockManyCalls = 0;
  async lowStockMany(depotIds: string[], _token: string): Promise<Map<string, LowStockLine[]> | null> {
    this.lowStockManyCalls += 1;
    return new Map(depotIds.map((id) => [id, LOW_STOCK[id] ?? []]));
  }
  /* CA-2-59: depot-service down means there is no list of depots to report on at all,
     which is a different failure from any single cost source being unreadable. */
  depotsDown = false;
  async allDepots(_token: string): Promise<NetworkDepot[] | null> {
    // Independent of `orderDown` — depot-service is a distinct source; lets the
    // network test exercise "order down but depots/SLA still list".
    return this.depotsDown ? null : ALL_DEPOTS;
  }
  async slaByDepot(_range: DateRange, _token: string): Promise<DepotSlaByDepot | null> {
    return SLA_BY_DEPOT;
  }
  async ratingByDepot(_range: DateRange, _token: string): Promise<DepotRatingByDepot | null> {
    return this.orderDown ? null : RATING_BY_DEPOT;
  }
  async depotMonthly(
    depotId: string,
    month: string,
    _token: string,
  ): Promise<DepotMonthlyRevenue | null> {
    return this.orderDown ? null : { depotId, month, orders: 12, revenueIdr: 1_000_000 };
  }
  costsDown = false;
  async operationalCosts(
    depotId: string,
    range: Required<DateRange>,
    _token: string,
  ): Promise<DepotOperationalCosts | null> {
    if (this.costsDown) return null;
    return {
      depotId,
      ...range,
      reportType: 'OPERATIONAL_MANAGEMENT',
      disclaimer: 'Operational management report only; not statutory accounting or a tax statement.',
      cogs: {
        amountIdr: 400_000,
        coveredAmountIdr: 400_000,
        totalUnits: 100,
        coveredUnits: 100,
        uncoveredUnits: 0,
        status: 'complete',
        valuationMethod: 'LATEST_RECEIVED_DIRECT_PRODUCT_COST',
        uncoveredItems: [],
      },
      opex: {
        amountIdr: 150_000,
        coveredAmountIdr: 150_000,
        status: 'complete',
        includedEntries: 2,
        excludedProcurementAmountIdr: 400_000,
        excludedProcurementEntries: 1,
        unverifiedProcurementAmountIdr: 0,
        unverifiedProcurementEntries: 0,
        exclusionRule: 'NORMALIZED_CATEGORY_PO_AND_RECEIVED_PO_SOURCE_REF',
      },
    };
  }
  /* CA-2-59: an hr-service one release behind answers without `payrollMtdGross`, and the
     P&L must read that as UNKNOWN rather than as a month with no wage bill. */
  hrOmitsGross = false;
  hrDown = false;
  async hrSummary(depotId: string): Promise<HrDepotSummary | null> {
    if (this.hrDown) return null;
    const row = { depotId, lateToday: 1, absentToday: 2, presentToday: 5, payrollMtdNet: 3_000_000, payrollMtdGross: 4_000_000, activeHeadcount: 8 };
    if (this.hrOmitsGross) delete (row as { payrollMtdGross?: number }).payrollMtdGross;
    return row;
  }
  hrSummaryManyCalls = 0;
  hrSummaryManyMonth: string | undefined;
  async hrSummaryMany(depotIds: string[], month?: string): Promise<(HrDepotSummary | null)[]> {
    this.hrSummaryManyCalls += 1;
    this.hrSummaryManyMonth = month;
    return Promise.all(depotIds.map((id) => this.hrSummary(id)));
  }
  /* CA-2-59. Null on either of these means the source could not be read at all, which the
     P&L must report as unknown rather than as a cost of zero — so both are switchable. */
  payoutCostsResult: Map<string, { commissionIdr: number; expenseClaimIdr: number }> | null =
    new Map();
  async payoutCosts(
    depotIds: string[],
    _range: { from: string; to: string },
  ): Promise<Map<string, { commissionIdr: number; expenseClaimIdr: number }> | null> {
    if (this.payoutCostsResult === null) return null;
    const out = new Map(this.payoutCostsResult);
    for (const id of depotIds) {
      if (!out.has(id)) out.set(id, { commissionIdr: 250_000, expenseClaimIdr: 50_000 });
    }
    return out;
  }
  depotRefundsResult: Map<string, number> | null = new Map();
  async depotRefunds(
    depotIds: string[],
    _range: { from: string; to: string },
  ): Promise<Map<string, number> | null> {
    if (this.depotRefundsResult === null) return null;
    const out = new Map(this.depotRefundsResult);
    for (const id of depotIds) if (!out.has(id)) out.set(id, 100_000);
    return out;
  }
  async crmSummary(_depotId: string): Promise<CrmDepotSummary | null> {
    return { counts: { baru: 1, aktif: 3, inactive: 2, total: 6 }, repeatRatePct: 50, followUps: [{ customerId: 'c1' }] };
  }
  crmSummaryManyCalls = 0;
  async crmSummaryMany(depotIds: string[]): Promise<(CrmDepotSummary | null)[]> {
    this.crmSummaryManyCalls += 1;
    return Promise.all(depotIds.map((id) => this.crmSummary(id)));
  }
}
