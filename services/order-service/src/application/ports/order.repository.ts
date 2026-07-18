import { OrderStatus } from '../../domain/order-status';

export interface OrderItemRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderStatusHistoryRecord {
  status: OrderStatus;
  changedBy: string | null;
  note: string | null;
  createdAt: Date;
}

export interface DeliveryAddressSnapshot {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export interface OrderRecord extends DeliveryAddressSnapshot {
  id: string;
  orderNumber: string;
  customerId: string;
  depotId: string | null;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  /** Display name of the assigned courier (null until DRIVER_ASSIGNED). */
  driverName: string | null;
  items: OrderItemRecord[];
  history: OrderStatusHistoryRecord[];
  /** Whether the customer has already rated this order (spec 7c). */
  reviewed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderReviewRecord {
  id: string;
  orderId: string;
  customerId: string;
  rating: number;
  aspects: string[];
  comment: string | null;
  tipAmount: number;
  createdAt: Date;
}

export interface CreateReviewData {
  orderId: string;
  customerId: string;
  rating: number;
  aspects: string[];
  comment: string | null;
  tipAmount: number;
}

export interface CreateOrderItemData {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface CreateOrderData extends DeliveryAddressSnapshot {
  /** Pre-generated id so stock can be reserved (keyed by order id) before the row is created. */
  id?: string;
  orderNumber: string;
  customerId: string;
  depotId: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  items: CreateOrderItemData[];
}

export interface OrderQuery {
  customerId?: string;
  status?: OrderStatus;
  depotId?: string;
  page: number;
  limit: number;
}

/** Reporting window. Both bounds optional; open-ended when absent. */
export interface ReportRange {
  from?: Date;
  to?: Date;
}

export interface SalesBucket {
  /** YYYY-MM-DD for daily granularity, YYYY-MM for monthly. */
  period: string;
  orderCount: number;
  revenue: number;
}

export interface CustomerSales {
  customerId: string;
  orderCount: number;
  revenue: number;
}

export interface DepotSales {
  depotId: string;
  orderCount: number;
  revenue: number;
}

/** Shipping (ongkir) billed per depot over a range — reconciliation 22a. */
export interface DepotShipping {
  depotId: string;
  shippingBilled: number;
}

/** Refunds settled per depot over a range — reconciliation 22a. */
export interface DepotRefund {
  depotId: string;
  refunded: number;
}

/** Average customer rating (1..5) per depot over a range — depot compare 14d. */
export interface DepotRating {
  depotId: string;
  rating: number;
  reviewCount: number;
}

/** Mean rating over a set of orders (courier weekly performance, design 4c). */
export interface RatingSummary {
  /** Mean of the reviews found, 1..5; null when none of the orders were reviewed. */
  average: number | null;
  /** How many of the orders had a review. */
  count: number;
}

/**
 * Revenue grouped by the ordered product (22b). OrderItem snapshots productId +
 * productName but NOT a category, so this groups by product — a true category
 * breakdown would need a cross-service join into product-service (not done here).
 */
export interface ProductRevenue {
  productId: string;
  productName: string;
  orderCount: number;
  revenue: number;
}

/** One (cohort-month, months-since-cohort) cell of the retention grid (22b). */
export interface RetentionCell {
  /** Cohort = first-order month, 'YYYY-MM'. */
  cohort: string;
  /** Months elapsed since the cohort month (0 = the cohort's own month). */
  monthIndex: number;
  /** Distinct customers from this cohort active in that later month. */
  customers: number;
}

/** A single customer's lifetime aggregates over the order book (17e / Customer 360). */
export interface CustomerLifetime {
  orderCount: number;
  revenue: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

/**
 * Activity-based segment conditions over the order book (Phase 4c, design 21d).
 * Every condition is AND-combined; distinct customers matching them all are counted.
 * `tier` is NOT here — it is owned by loyalty-service and not joinable in order-service.
 */
export interface SegmentConditions {
  /** Last order at-or-after this cutoff (recency = still active). */
  recencyCutoff?: Date;
  /** Last order STRICTLY BEFORE this cutoff (lapsed / at-risk — has ordered, not lately). */
  lapsedCutoff?: Date;
  /** First order at-or-after this cutoff (newly acquired customer). */
  firstOrderCutoff?: Date;
  /** At least this many (non-cancelled) orders (frequency). */
  minOrders?: number;
  /** Has ordered at this depot; also scopes recency/frequency to that depot's orders. */
  depotId?: string;
}

export interface OrderRepository {
  create(data: CreateOrderData): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  search(query: OrderQuery): Promise<{ items: OrderRecord[]; total: number }>;
  /** CREATED orders placed before `before` — unconfirmed, treated as abandoned. */
  findStaleCreated(before: Date): Promise<OrderRecord[]>;
  /**
   * Keyset-paginated COMPLETED orders ordered by (createdAt asc, id asc), for the
   * recommendation-service rebuild feed. `cursor` is opaque (the id of the first
   * not-yet-returned row from a prior page) — `null` starts from the beginning.
   * `nextCursor` is the id of the row just past `limit`, or `null` on the last page.
   */
  findCompletedPage(
    cursor: string | null,
    limit: number,
  ): Promise<{ orders: OrderRecord[]; nextCursor: string | null }>;
  /**
   * Customers whose most-recent order predates `cutoff` (candidates for a "time to
   * refill" nudge, spec 5h). One row per customer — the latest order's phone + name.
   */
  findReorderReminderTargets(
    cutoff: Date,
    limit: number,
  ): Promise<{ customerId: string; phone: string; recipientName: string }[]>;
  /** Persist a customer's review of an order (one per order). */
  createReview(data: CreateReviewData): Promise<OrderReviewRecord>;
  /** The review for an order, or null if not yet rated. */
  findReviewByOrderId(orderId: string): Promise<OrderReviewRecord | null>;
  /** Mean rating over the given orders (courier weekly performance, design 4c). */
  avgRatingForOrders(orderIds: string[]): Promise<RatingSummary>;
  /** Atomically move the order to `status` and append a history row. Sets driverName when given. */
  applyStatus(
    id: string,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
    driverName?: string | null,
  ): Promise<OrderRecord>;
  /** Revenue/order counts bucketed by day or month (CANCELLED excluded). FR-095/096. */
  salesSeries(granularity: 'daily' | 'monthly', range: ReportRange): Promise<SalesBucket[]>;
  /** Highest-spending customers in the window (CANCELLED excluded). FR-097. */
  topCustomers(range: ReportRange, limit: number): Promise<CustomerSales[]>;
  /** Highest-revenue depots in the window (null depot & CANCELLED excluded). FR-098. */
  topDepots(range: ReportRange, limit: number): Promise<DepotSales[]>;
  shippingByDepot(range: ReportRange): Promise<DepotShipping[]>;
  /** Refunds settled per depot (null depot excluded) — reconciliation 22a. */
  refundsByDepot(range: ReportRange): Promise<DepotRefund[]>;
  /** Record the refunded amount on an order (payment-service coordination). Idempotent set. */
  recordRefund(orderId: string, amount: number): Promise<void>;
  /** Average rating per depot (orders in-window that have a review), 14d. */
  ratingByDepot(range: ReportRange): Promise<DepotRating[]>;
  /** Revenue per product in the window (CANCELLED excluded), highest first (22b). */
  revenueByProduct(range: ReportRange, limit: number): Promise<ProductRevenue[]>;
  /**
   * Retention cells: for each first-order cohort month, distinct customers still
   * ordering `monthIndex` months later (CANCELLED excluded). The service pivots
   * these into per-cohort retention rows (22b).
   */
  retentionCohort(range: ReportRange): Promise<RetentionCell[]>;
  /** One customer's lifetime revenue/order-count/first-last dates (17e). */
  customerLifetime(customerId: string): Promise<CustomerLifetime>;
  /**
   * Distinct customers reachable for a broadcast (design 10d) — anyone with a
   * non-cancelled order (every order carries a phone). Scoped to one depot when given.
   */
  audienceReach(depotId?: string): Promise<number>;
  /** Distinct customers matching all activity-based segment conditions (design 21d). */
  segmentEstimate(conditions: SegmentConditions): Promise<number>;
  /**
   * Every order (INCLUDING cancelled) for one depot within the range, oldest first.
   * Backs the depot daily/weekly composites (design 2d/7d) — the service partitions
   * cancelled vs live itself (orders/revenue exclude cancelled; failed counts them).
   */
  ordersForDepot(depotId: string, range: ReportRange): Promise<OrderRecord[]>;
}
