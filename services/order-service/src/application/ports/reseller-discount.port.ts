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
}
