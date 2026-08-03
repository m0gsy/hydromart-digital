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
}
