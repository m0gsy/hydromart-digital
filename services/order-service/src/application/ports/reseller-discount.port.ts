export interface ResellerDiscount {
  active: boolean;
  discountPct: number;
}

/**
 * Resolves the checking-out customer's reseller pricing from customer-service.
 * Fails OPEN: null on any error / timeout / 404 (caller treats null as "not a reseller").
 */
export interface ResellerDiscountPort {
  get(authorization: string): Promise<ResellerDiscount | null>;
}
