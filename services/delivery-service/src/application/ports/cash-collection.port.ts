/** PAID cash a courier collected on ONE order — read from payment-service. */
export interface OrderCash {
  orderId: string;
  amountIdr: number;
}

/** PAID cash a courier collected over a set of orders — read from payment-service. */
export interface CashCollected {
  total: number;
  count: number;
  /**
   * The same PAID cash kept per order. C1 needs it: the expected deposit is decided one
   * order at a time (`max(codAmount, cash PAID)`), and a single total cannot answer that.
   * Orders with no PAID cash are absent rather than returned as zero rows.
   */
  byOrder: OrderCash[];
}

/**
 * Reads the PAID-cash total over delivered orders from payment-service. This is
 * the "how much" in a COD settlement — delivery-service owns "which orders",
 * payment-service owns the money — so the call fails closed (money must not be
 * guessed) and forwards the caller's bearer for RBAC.
 */
export interface CashCollectionPort {
  sumCollected(orderIds: string[], authorization: string): Promise<CashCollected>;
}
