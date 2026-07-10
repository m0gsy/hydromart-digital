import {
  DashboardSourcesPort,
  DateRange,
  DeliverySla,
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
  async deliverySla(_range: DateRange, _token: string): Promise<DeliverySla | null> {
    return DELIVERY_SLA;
  }
}
