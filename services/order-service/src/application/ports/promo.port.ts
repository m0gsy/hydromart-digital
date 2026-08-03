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
  ): Promise<{ discount: number; discountType?: string }>;

  redeem(
    code: string,
    customerId: string,
    orderId: string,
    subtotal: number,
    shippingFee: number,
    authorization: string,
  ): Promise<void>;
}
