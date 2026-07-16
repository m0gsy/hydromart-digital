import {
  DashboardSourcesPort,
  DateRange,
  DeliverySla,
  DepotSlaByDepot,
  FranchiseDepot,
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
  items: [{ depotId: 'depot-1', orderCount: 30, revenue: 900_000 }],
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
  depots: [{ depotId: 'depot-1', slaRate: 0.9 }],
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
  async allDepots(_token: string): Promise<NetworkDepot[] | null> {
    // Independent of `orderDown` — depot-service is a distinct source; lets the
    // network test exercise "order down but depots/SLA still list".
    return ALL_DEPOTS;
  }
  async slaByDepot(_range: DateRange, _token: string): Promise<DepotSlaByDepot | null> {
    return SLA_BY_DEPOT;
  }
}
