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
}
