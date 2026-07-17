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
   * Records a settled refund amount on the order so order-service can report refunds
   * per depot (reconciliation 22a). Same fail-open contract as confirmPaid: the refund
   * is already settled, so a coordination hiccup must never surface as a payment error.
   */
  notifyRefunded(orderId: string, amount: number): Promise<void>;
}
