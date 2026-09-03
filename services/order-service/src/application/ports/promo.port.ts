/**
 * Validates and redeems discount vouchers against the promo-service at checkout.
 *
 * `quote` is money-critical and fails CLOSED: if a voucher was supplied but cannot
 * be validated (invalid, or promo-service unreachable), checkout is rejected rather
 * than silently dropping the customer's voucher.
 *
 * `redeem` records the redemption after the order is persisted and fails OPEN: it is
 * idempotent per order on the promo side, so a failure only risks under-counting
 * usage, never blocking a paid order.
 */
export interface PromoPort {
  quote(
    code: string,
    customerId: string,
    subtotal: number,
    shippingFee: number,
    authorization: string,
    /**
     * CA-2-65: the depot fulfilling this order.
     *
     * A voucher a depot manager requested for their own area used to be spendable across
     * the whole network. The check belongs HERE, on the quote, and not on `redeem`: redeem
     * fails open by design so an order already priced with the discount would keep it.
     *
     * Optional on the wire only. promo-service REFUSES a depot-scoped voucher when the
     * caller could not say which depot — the unknown case is not the permissive one.
     */
    depotId?: string | null,
  ): Promise<{ discount: number; discountType?: string }>;

  /**
   * The same quote for a named customer, over the internal service path. Used by the
   * counter sale, where the call carries the cashier's token: quoting by token there
   * would price the CASHIER's wallet and hand the buyer a voucher they never owned.
   * Fails CLOSED exactly like `quote`.
   */
  quoteFor(
    code: string,
    customerId: string,
    subtotal: number,
    shippingFee: number,
    /** CA-2-65: the depot the counter sale is rung up at. See `quote`. */
    depotId?: string | null,
  ): Promise<{ discount: number; discountType?: string }>;

  redeem(
    code: string,
    customerId: string,
    orderId: string,
    subtotal: number,
    shippingFee: number,
    authorization: string,
    /** CA-2-65: recorded with the redemption; the gate is `quote`. */
    depotId?: string | null,
  ): Promise<void>;

  /**
   * C4: give the buyer their voucher back when the sale it paid for is voided.
   *
   * This port had NO reversal method at all, so a voided counter sale returned the goods
   * and the money while the voucher stayed burned — a single-use voucher spent on a sale
   * that never happened, and nothing downstream could even ask for it back.
   *
   * Fails OPEN, unlike `redeem`. The asymmetry is deliberate and is the opposite of B-6's
   * reasoning: a failed BURN leaves money given away against a live voucher, so it must
   * fail the checkout; a failed RELEASE leaves a voucher un-returned on a sale that is
   * already reversed. Blocking the void over it would strand the buyer at the counter with
   * neither goods nor refund, to protect one voucher use. Idempotent per order, so the
   * retry that follows costs nothing.
   */
  release(orderId: string): Promise<void>;
}
