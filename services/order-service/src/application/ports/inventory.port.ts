/** One sold product line to deduct from a depot's stock. */
export interface SoldLine {
  productId: string;
  quantity: number;
}

/**
 * Moves stock on the fulfilling depot as an order progresses.
 *
 * `consume` throws so its outbox row retries after the order changes state. `restock`
 * and `release` remain best-effort; `reserve` rejects checkout before the sale is promised.
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
   * Puts back stock a voided counter sale had already consumed. Fails OPEN:
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
