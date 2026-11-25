/** What a source answered, and whether it held more than one answer can carry (the rest comes on the next tick). */
export interface Counted<T> {
  rows: T[];
  truncated: boolean;
}

export interface DueSubscription {
  id: string;
  customerId: string;
  productName: string;
  quantity: number;
  nextDeliveryAt: Date;
}

export interface ExpiringPointLot {
  lotId: string;
  customerId: string;
  points: number;
  expiresAt: Date;
}

export interface UnpaidOrder {
  orderId: string;
  customerId: string;
  orderNumber: string;
  total: number;
}

/**
 * HD-18: who to remind, asked of the services that own the data (order-service, loyalty-service).
 * Customer ids come back to crm and stay in hydromart; n8n never sees them. Every method THROWS
 * when its service does not answer: a reminder round that could not read is retried, not skipped.
 */
export interface CustomerReminderSourcePort {
  /** ACTIVE subscriptions whose next delivery falls in `[from, to)`. */
  subscriptionsDue(from: Date, to: Date): Promise<Counted<DueSubscription>>;
  /** EARN lots that expire within `withinDays` of now and have points left to lose. */
  expiringPoints(withinDays: number): Promise<Counted<ExpiringPointLot>>;
  /** Transfer/QR orders still unpaid inside order-service's reminder window. */
  unpaidOrders(): Promise<Counted<UnpaidOrder>>;
}
