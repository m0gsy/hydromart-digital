export interface ResellerDiscount {
  active: boolean;
  discountPct: number;
  /**
   * Depot SOP: a flat rupiah price per galon (Rp5.000), which wins over `discountPct`
   * when > 0. A percentage cannot express it — the SOP price is the same whatever the
   * galon lists at, so the discount has to be computed per line, not off the subtotal.
   */
  flatGallonPriceIdr: number;
}

/**
 * Resolves the checking-out customer's reseller pricing from customer-service.
 * Fails OPEN: null on any error / timeout / 404 (caller treats null as "not a reseller").
 */
export interface ResellerDiscountPort {
  get(authorization: string): Promise<ResellerDiscount | null>;
  /**
   * The same pricing for a NAMED buyer, used by the counter sale. `get` reads `/resellers/me`
   * off the caller's token, which at a till is the CASHIER's — it would price the cashier's
   * own agen status and charge the buyer by it. Fails OPEN the same way.
   */
  getFor(customerId: string, authorization: string): Promise<ResellerDiscount | null>;
}
