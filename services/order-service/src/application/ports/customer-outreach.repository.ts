/** HD-18: what the n8n-facing routes read from orders and subscriptions. */

/** One order as the "where is my order" answer needs it, and nothing more (no address, name or courier). */
export interface StatusOrderRow {
  id: string;
  orderNumber: string;
  createdAt: Date;
  status: string;
  total: number;
  depotId: string | null;
  deliveryWindow: string | null;
  scheduledFor: Date | null;
  items: { productName: string; quantity: number }[];
}

export interface DueSubscriptionRow {
  id: string;
  customerId: string;
  productName: string;
  quantity: number;
  nextDeliveryAt: Date;
  /** Where it delivers, to tell which depot (and so which quality hold) it falls under. */
  latitude: number | null;
  longitude: number | null;
}

export interface UnpaidCandidateRow {
  id: string;
  customerId: string;
  orderNumber: string;
  total: number;
  depotId: string | null;
}

export interface CustomerOutreachRepository {
  /** The customer's orders still moving (newest first, bounded) and their last `finished` finished or cancelled ones. */
  statusOrders(customerId: string, finished: number): Promise<{ running: StatusOrderRow[]; recent: StatusOrderRow[] }>;
  /** ACTIVE subscriptions whose next delivery falls in `[from, to)`. */
  subscriptionsDueBetween(from: Date, to: Date, limit: number): Promise<DueSubscriptionRow[]>;
  /**
   * Delivery orders of a named customer still CREATED that entered that status in `(after, upTo]`,
   * oldest first. Counter sales and subscription deliveries are never candidates (the abandoned
   * sweep leaves the latter alone, and a counter sale is paid at the till).
   */
  createdOrdersBetween(after: Date, upTo: Date, limit: number): Promise<UnpaidCandidateRow[]>;
}

export const CUSTOMER_OUTREACH_REPOSITORY = Symbol('CustomerOutreachRepository');
