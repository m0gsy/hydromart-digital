/** ISO date-range filter forwarded verbatim to upstream report endpoints. */
export interface DateRange {
  from?: string;
  to?: string;
}

export interface SalesReport {
  granularity: string;
  from: string | null;
  to: string | null;
  buckets: { period: string; orderCount: number; revenue: number }[];
}

export interface TopCustomers {
  from: string | null;
  to: string | null;
  items: { customerId: string; orderCount: number; revenue: number }[];
}

export interface TopDepots {
  from: string | null;
  to: string | null;
  items: { depotId: string; orderCount: number; revenue: number }[];
}

export interface DeliverySla {
  from: string | null;
  to: string | null;
  thresholdMinutes: number;
  totalDelivered: number;
  onTime: number;
  breached: number;
  slaRate: number;
  avgMinutes: number | null;
  failedCount: number;
}

/**
 * Reads report data from downstream services (order + delivery). Each method
 * forwards the caller's bearer token and returns `null` on any failure so the
 * dashboard degrades gracefully rather than propagating a downstream blip.
 */
export interface DashboardSourcesPort {
  sales(range: DateRange, token: string): Promise<SalesReport | null>;
  topCustomers(range: DateRange, limit: number, token: string): Promise<TopCustomers | null>;
  topDepots(range: DateRange, limit: number, token: string): Promise<TopDepots | null>;
  deliverySla(range: DateRange, token: string): Promise<DeliverySla | null>;
}
