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
  /**
   * Holds stock for the order at checkout (oversell prevention). Unlike the other
   * inventory calls this is NOT fully fail-open: a genuine shortfall (422) throws
   * InsufficientStockError to reject the checkout, but any other failure (depot-service
   * down, missing token) fails OPEN so inventory availability never blocks ordering.
   */
  reserve(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void>;
  /**
   * Puts back stock a voided counter sale had already consumed. Fails OPEN like `consume`:
   * the buyer has the money back and the goods on the counter, and a depot-service blip must
   * not leave the order un-voided. Opname reconciles a missed put-back.
   */
  restock(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void>;
  /** Releases an order's stock holds on cancellation. Fails OPEN. */
  release(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void>;
}
