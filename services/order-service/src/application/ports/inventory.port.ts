/** One sold product line to deduct from a depot's stock. */
export interface SoldLine {
  productId: string;
  quantity: number;
}

/**
 * Moves stock on the fulfilling depot as an order progresses.
 *
 * The calls do not share a failure policy. `consume`, `restock` and `release` run AFTER
 * an order has already changed state, so they fail OPEN — throwing would strand a
 * completion, void or cancellation that otherwise succeeded, and opname reconciles a
 * missed movement. `reserve` runs BEFORE the sale is promised and fails CLOSED; see its
 * own note. Treating those two situations the same is what caused B-6b.
 */
export interface InventoryPort {
  consume(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void>;
  /**
   * Holds stock for the order at checkout (oversell prevention). This one fails CLOSED
   * (B-6b): a genuine shortfall throws InsufficientStockError, and anything that leaves us
   * without a verdict — depot-service down, timeout, 5xx, no internal key — throws
   * StockCheckUnavailableError. Reserve is what makes the sale safe to promise, so
   * "could not check" must not be read as "fine". The one safe skip is an empty cart.
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
