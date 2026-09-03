/**
 * Notifies order-service that an order's payment has settled PAID so it can confirm
 * the order (CREATED→CONFIRMED, firing the customer's ORDER_CONFIRMED WhatsApp).
 * Called over the internal service-auth path. Implementations MUST fail open: the
 * payment is already settled, so an order-confirm hiccup must never surface as a
 * payment error. Idempotent on the order side.
 */
export interface OrderCoordinationPort {
  confirmPaid(orderId: string): Promise<void>;
  /**
   * Reads an order's authoritative total to validate a client-supplied payment amount
   * before charging (SEC-1, price-tampering). Returns null only when the coordination
   * path is not configured (dev/no order-service) — the caller then skips validation.
   * A configured-but-failing fetch MUST throw so a mispriced payment is never created.
   */
  getOrderTotal(orderId: string): Promise<number | null>;
  /**
   * Records a settled refund amount on the order so order-service can report refunds
   * per depot (reconciliation 22a). Same fail-open contract as confirmPaid: the refund
   * is already settled, so a coordination hiccup must never surface as a payment error.
   */
  notifyRefunded(orderId: string, amount: number): Promise<void>;
  /**
   * Human-readable HM-… numbers for a batch of order ids (§G-3). The refund queue is the
   * one screen in the console that had no order number on it, because payment rows carry
   * only the id — HQ was approving refunds against eight hex characters.
   *
   * Fails SOFT: an id with no number simply stays absent from the map, and the queue
   * falls back to the short id. A refund decision must never be blocked by a decoration.
   */
  getOrderNumbers(orderIds: string[]): Promise<Map<string, string>>;
  /**
   * CA-2-34: the current status of a batch of orders, for the refund queue.
   *
   * A cancelled order that was paid gets its money back — that is the owner's rule — so a
   * REJECTION on one has to be refused. A payment row knows nothing about the order beyond
   * its id, so this is the only way to ask.
   *
   * Fails SOFT here, like `getOrderNumbers`: an id that could not be read simply stays out
   * of the map. The CALLER decides what an absent answer means, and for the rejection path
   * it means "refuse" — see `rejectRefund`. Decorating a queue and blocking a decision are
   * different jobs, and only one of them may be wrong in the customer's favour.
   */
  getOrderStatuses(orderIds: string[]): Promise<Map<string, string>>;
  /**
   * The depot an order belongs to, or null if it is unassigned, unknown, or order-service
   * could not be reached (AUTHZ-2).
   *
   * Fails CLOSED at the caller, not here: `null` means "cannot prove this money is yours",
   * and a depot-scoped caller is refused on it. Only asked when the caller IS depot-scoped,
   * so the finance/HQ settlement path costs no extra round trip.
   */
  getOrderDepot(orderId: string): Promise<string | null>;
}
