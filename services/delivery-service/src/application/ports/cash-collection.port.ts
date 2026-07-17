/** PAID cash a courier collected over a set of orders — read from payment-service. */
export interface CashCollected {
  total: number;
  count: number;
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
