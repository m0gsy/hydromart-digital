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

/** A depot owned by the calling franchise owner (subset of depot-service DepotRecord). */
export interface FranchiseDepot {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

/** A low-stock line (subset of depot-service ItemView); only the count is consumed. */
export interface LowStockLine {
  itemId: string;
  depotId: string;
}

/** Any depot in the network (subset of depot-service DepotRecord, incl. inactive). */
export interface NetworkDepot {
  id: string;
  code: string;
  name: string;
  active: boolean;
  ownershipType: string;
}

/** One depot's on-time SLA (subset of delivery-service DepotSlaRow). */
export interface DepotSlaRow {
  depotId: string;
  slaRate: number;
  /** Average delivered-order lead time in minutes, or null when none delivered. */
  avgMinutes: number | null;
}

/** Per-depot SLA report (delivery-service GET /reports/sla-by-depot). */
export interface DepotSlaByDepot {
  from: string | null;
  to: string | null;
  depots: DepotSlaRow[];
}

/** Per-depot rating report (order-service GET /reports/rating-by-depot). */
export interface DepotRatingByDepot {
  items: { depotId: string; rating: number; reviewCount: number }[];
}

/**
 * Reads report data from downstream services (order + delivery + depot). Each
 * method forwards the caller's bearer token and returns `null` on any failure
 * so the dashboard degrades gracefully rather than propagating a downstream blip.
 */
export interface DashboardSourcesPort {
  sales(range: DateRange, token: string): Promise<SalesReport | null>;
  topCustomers(range: DateRange, limit: number, token: string): Promise<TopCustomers | null>;
  topDepots(range: DateRange, limit: number, token: string): Promise<TopDepots | null>;
  /** SLA over the window; `depotIds` scopes it per-franchise (omit for global). */
  deliverySla(range: DateRange, token: string, depotIds?: string[]): Promise<DeliverySla | null>;
  /** Depots owned by the calling franchise owner (depot-service GET /depots/mine). */
  myDepots(token: string): Promise<FranchiseDepot[] | null>;
  /** Low-stock lines for one depot (depot-service GET /inventory/low-stock?depotId=). */
  lowStock(depotId: string, token: string): Promise<LowStockLine[] | null>;
  /** Every depot incl. inactive (depot-service GET /depots/manage); for the network roll-up. */
  allDepots(token: string): Promise<NetworkDepot[] | null>;
  /** On-time SLA grouped per depot (delivery-service GET /reports/sla-by-depot). */
  slaByDepot(range: DateRange, token: string): Promise<DepotSlaByDepot | null>;
  /** Average rating grouped per depot (order-service GET /reports/rating-by-depot). */
  ratingByDepot(range: DateRange, token: string): Promise<DepotRatingByDepot | null>;
}
