/**
 * Notifies order-service that an order's payment has settled PAID so it can confirm
 * the order (CREATED→CONFIRMED, firing the customer's ORDER_CONFIRMED WhatsApp).
 * Called over the internal service-auth path. Implementations MUST fail open: the
 * payment is already settled, so an order-confirm hiccup must never surface as a
 * payment error. Idempotent on the order side.
 */
export interface OrderCoordinationPort {
  confirmPaid(orderId: string): Promise<void>;
}
