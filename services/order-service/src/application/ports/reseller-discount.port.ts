export interface ResellerDiscount {
  active: boolean;
  discountPct: number;
  /**
   * Depot SOP: a flat rupiah price per galon (Rp5.000), which wins over `discountPct`
   * when > 0. A percentage cannot express it — the SOP price is the same whatever the
   * galon lists at, so the discount has to be computed per line, not off the subtotal.
   */
  flatGallonPriceIdr: number;
  /**
   * A9: the ONE depot this agen is registered at.
   *
   * Nothing used to carry it, so nothing could ask — and "is this a reseller" was answered
   * without ever asking "whose reseller". An agen enrolled at depot A drew their agen price
   * shopping at depot B, franchises included: someone else's margin, funding a discount
   * their depot never granted.
   *
   * Null only from `get` on a peer that predates the field; the counter path always has it.
   */
  homeDepotId: string | null;
}

/**
 * Resolves a customer's reseller pricing from customer-service.
 *
 * The two reads deliberately fail in OPPOSITE directions (A5/A6).
 */
export interface ResellerDiscountPort {
  /**
   * Checkout, on the customer's own token. Still fails OPEN — a customer-service outage
   * must not stop anyone from ordering water — but the caller records that it happened
   * (A5), because "charged full price" and "charged full price because a read failed" used
   * to be the same silent outcome.
   */
  get(authorization: string): Promise<ResellerDiscount | null>;
  /**
   * The same pricing for a NAMED buyer at a counter, read over the internal key.
   *
   * Fails CLOSED: throws when the read fails, returns null ONLY for "not a reseller".
   * A counter sale is a person standing at a till who can be told to wait ten seconds;
   * quietly charging an agen retail is worse than making the cashier retry. This is the
   * opposite call from `get` and the difference is the whole point of A6.
   */
  getFor(customerId: string): Promise<ResellerDiscount | null>;
}
