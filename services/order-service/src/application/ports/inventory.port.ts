/** One sold product line to deduct from a depot's stock. */
export interface SoldLine {
  productId: string;
  quantity: number;
}

/**
 * Deducts sold quantities from the fulfilling depot's stock when an order
 * completes. Inventory is non-critical to fulfilment, so implementations fail
 * OPEN: a failure (depot-service down, missing token) must never block completing
 * an order. Reconciliation happens at opname if a deduction is ever missed.
 */
export interface InventoryPort {
  consume(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void>;
}
