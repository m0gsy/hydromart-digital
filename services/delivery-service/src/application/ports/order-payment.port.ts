/** An order's payment as payment-service knows it. `amount` is what was charged. */
export interface OrderPaymentSnapshot {
  method: string;
  amount: number;
}

/**
 * Reads the order's payment so THIS service decides whether the courier collects on
 * delivery — the console used to decide, and it could not.
 *
 * Assignment is guarded by `tracking` (KEPALA_DEPOT, MANAGER, SUPERVISOR,
 * ASSISTANT_SUPERVISOR, SUPER_ADMIN) while the staff payment read is guarded by
 * `paymentSettle` (KEPALA_DEPOT, MANAGER, STAFF_DEPOT, FINANCE, SUPER_ADMIN). The two
 * supervisor roles are in the first list and not the second, so their payment read was a
 * 403 on EVERY dispatch — and the client turned that into "not a cash order", which sends
 * the courier out collecting nothing. Reading it here removes the client from the decision
 * altogether, along with every other way that read could fail (429, expired token, a phone
 * that lost signal between the two requests).
 *
 * Returns null when the order genuinely has no payment row. THROWS when payment-service
 * cannot answer: COD is money, and a guess is the one answer that must not ship.
 */
export interface OrderPaymentPort {
  forOrder(orderId: string): Promise<OrderPaymentSnapshot | null>;
}
