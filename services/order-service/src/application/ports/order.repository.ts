import { OrderStatus } from '../../domain/order-status';

import { OutboxWrite } from './outbox.repository';

export interface OrderItemRecord {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  /** Snapshotted fill volume (ml). Null = unmeasured line, not zero litres. */
  volumeMl: number | null;
  /** Snapshotted galon flag: delivery fee + report gallon counts read this. */
  isGallon: boolean;
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
  /** Assigned courier's phone (null until DRIVER_ASSIGNED); lets the customer call the driver. */
  driverPhone: string | null;
  /** Customer-facing ETA (null until ON_DELIVERY), set by delivery-service. */
  estimatedArrivalAt: Date | null;
  /** Customer's preferred delivery time-window (free-form label), null when not given. */
  deliveryWindow: string | null;
  /** Cash sale recorded at the depot counter (no courier, no delivery fee). */
  isWalkIn: boolean;
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
  volumeMl: number | null;
  isGallon: boolean;
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
  /** Optional customer-preferred delivery time-window (free-form label). */
  deliveryWindow?: string | null;
  /** Opening status. Defaults to CREATED; a walk-in sale opens already COMPLETED. */
  status?: OrderStatus;
  /** Cash sale recorded at the depot counter — no cart, no courier, no delivery. */
  isWalkIn?: boolean;
  /**
   * Side effects the order owes the moment it exists, written in the same transaction
   * (H-10). Only a walk-in uses this: it is born COMPLETED, so it earns the completion
   * fan-out at creation rather than at a later transition.
   */
  outbox?: OutboxWrite[];
  /**
   * Client-supplied key for this checkout attempt (B-13). When set, the write is unique
   * per (customerId, key) and a retry carrying the same key raises DuplicateCheckoutError
   * instead of placing a second order.
   */
  idempotencyKey?: string | null;
  items: CreateOrderItemData[];
}

export interface OrderQuery {
  customerId?: string;
  status?: OrderStatus;
  depotIds?: readonly string[];
  /**
   * Only orders that reached no depot (`depotId IS NULL`). Legacy rows from when
   * checkout failed open — they match no depot filter, so HQ needs this tray to
   * find and assign them. Takes precedence over `depotIds`.
   */
  unrouted?: boolean;
  /** Case-insensitive substring matched against the order number (audit F-12). */
  orderNumber?: string;
  page: number;
  limit: number;
  /**
   * Opaque keyset cursor — the `nextCursor` of the previous page. When present the read
   * seeks straight to that row instead of walking and discarding every row before it
   * (audit Q-16); `page` is then ignored. Absent = the page-number behaviour clients have
   * always had.
   */
  cursor?: string;
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

/** One recent review card for the depot ratings screen (design 14b). */
export interface DepotRatingRecent {
  /** The order's recipient name (customer name is not stored on the review). */
  customerName: string;
  stars: number;
  comment: string | null;
  createdAt: Date;
}

/** One depot's ratings aggregate: average, count, star distribution + recent reviews (14b). */
export interface DepotRatingsDetail {
  /** Mean 1..5; null when the depot has no reviews in the window. */
  average: number | null;
  count: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  recent: DepotRatingRecent[];
}

/** Mean rating over a set of orders (courier weekly performance, design 4c). */
export interface RatingSummary {
  /** Mean of the reviews found, 1..5; null when none of the orders were reviewed. */
  average: number | null;
  /** How many of the orders had a review. */
  count: number;
}

export interface OrderValue {
  orderId: string;
  /** The human-readable HM-… number (§G-3): what every other console shows for an order. */
  orderNumber: string;
  totalIdr: number;
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
 * Per-customer order aggregate for a depot's CRM lifecycle (Fase 4). One row per
 * customer who has ordered at the depot (CANCELLED excluded). name/phone snapshot
 * comes from that customer's latest order at the depot — the WA follow-up target.
 */
export interface DepotCustomerAggregate {
  customerId: string;
  name: string | null;
  phone: string | null;
  orderCount: number;
  totalSpent: number;
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
  /**
   * The next value of the order-number counter, strictly increasing and never repeated.
   *
   * The number used to be six random digits, and `orderNumber` is `@unique` — so a
   * collision was not a cosmetic duplicate, it was a failed insert on a real customer's
   * checkout. At 1,000 orders/day the birthday bound puts that near 40% of days. A
   * Postgres sequence removes the class of bug rather than shrinking its probability:
   * `nextval` is transactional-safe, never hands the same value to two sessions, and
   * costs one round-trip.
   */
  nextOrderSequence(): Promise<number>;
  create(data: CreateOrderData): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  /** The order a previous attempt with this idempotency key already placed, if any (B-13). */
  findByIdempotencyKey(customerId: string, idempotencyKey: string): Promise<OrderRecord | null>;
  /** Fills in the fulfilling depot of an order that had none (HQ manual routing). */
  assignDepot(id: string, depotId: string): Promise<OrderRecord>;
  /** Existing orders only, selected in one query for internal cross-service reporting. */
  findOrderValues(orderIds: string[]): Promise<OrderValue[]>;
  /** Sum of fulfilled (DELIVERED/COMPLETED) order totals for a depot in [from, to]. IDR. */
  sumDepotSales(depotId: string, from: Date, to: Date): Promise<number>;
  search(query: OrderQuery): Promise<{ items: OrderRecord[]; total: number; nextCursor: string | null }>;
  /**
   * Orders in any of `statuses` placed before `before` — candidates for the stale sweep.
   * Oldest first and capped at `limit`, so one tick cannot try to load an unbounded
   * backlog; the next tick continues where this one stopped (audit H-47).
   */
  findStaleIn(statuses: OrderStatus[], before: Date, limit?: number): Promise<OrderRecord[]>;
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
  /**
   * Atomically move the order to `status` and append a history row. Sets driverName /
   * driverPhone (at DRIVER_ASSIGNED) and estimatedArrivalAt (at ON_DELIVERY) when given —
   * each is written only when non-null, so a later transition never clobbers a snapshot.
   */
  /**
   * Moves an order to `status`, but only from the `from` it was read at (H-4).
   *
   * The compare-and-set is the whole point: the legality check runs against a row read
   * moments earlier, and two staff — or a courier and the stall sweep — acting together
   * would otherwise both pass it and both write, running the completion fan-out twice.
   * A caller that loses gets StaleOrderStatusError, not a silent overwrite.
   */
  applyStatus(
    id: string,
    from: OrderStatus,
    status: OrderStatus,
    changedBy: string | null,
    note: string | null,
    driverName?: string | null,
    driverPhone?: string | null,
    estimatedArrivalAt?: Date | null,
    /**
     * Side effects this transition earns, written in the SAME transaction as it (H-10).
     * That is the whole point: an order cannot end up COMPLETED without the stock consume
     * and the owner credit being owed somewhere durable.
     */
    outbox?: OutboxWrite[],
  ): Promise<OrderRecord>;
  /**
   * Append a history row WITHOUT moving the order.
   *
   * For facts about an order that are not transitions — "this was priced from the catalog
   * because the depot was unreachable". Reusing `applyStatus` would work, but the timeline
   * is read by staff, and a repeated status entry reads as something having happened twice.
   */
  appendNote(id: string, status: OrderStatus, changedBy: string, note: string): Promise<void>;
  /**
   * Reverses a counter sale: stamps VOIDED with the reason and appends the history row.
   *
   * Its own method rather than a status transition — VOIDED is deliberately not an edge out
   * of COMPLETED, or every delivered order could be voided past the refund queue. Guarded
   * on the current status so a double-void writes nothing.
   */
  voidWalkIn(id: string, reason: string, changedBy: string, at: Date): Promise<OrderRecord>;
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
  /**
   * One depot's ratings detail: average, count, star distribution, and the most recent
   * reviews (design 14b). Reviews are joined to their parent order for depot + createdAt
   * scoping (OrderReview has no depotId of its own).
   */
  depotRatings(depotId: string, range: ReportRange): Promise<DepotRatingsDetail>;
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
  /** Per-customer order aggregates for a depot's CRM lifecycle (Fase 4, CANCELLED excluded). */
  depotCustomerAggregates(depotId: string): Promise<DepotCustomerAggregate[]>;
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
