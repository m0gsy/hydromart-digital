/**
 * Gives the buyer their money back when a counter sale is voided at the till.
 *
 * Fails CLOSED, and is called BEFORE the order is marked VOIDED. If the money cannot be
 * given back, the sale must keep standing: an order recorded as reversed while
 * payment-service still holds it PAID would show up as revenue the depot no longer has and
 * as cash the cashier can never account for at shift close.
 */
export interface PaymentReversalPort {
  voidForOrder(orderId: string, reason: string): Promise<void>;
  /**
   * K2.3: settle a CANCELLED order's payment — fail a PENDING one, refund a PAID one.
   *
   * Cancellation used to skip this service entirely: the order flipped to CANCELLED, the
   * stock came back, and the screen showed a paragraph explaining the refund rule instead
   * of a refund. Fails CLOSED for the same reason `voidForOrder` does, and is called
   * BEFORE the status is written — an order recorded as cancelled while its money is
   * still held is worse than an order that refused to cancel.
   */
  cancelForOrder(orderId: string, reason: string): Promise<void>;
}
