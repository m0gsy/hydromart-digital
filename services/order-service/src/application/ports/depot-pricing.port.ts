import { PriceAdjustType } from '../../domain/pricing';

/** A depot's resolved pricing for one product: optional override + optional active rule. */
export interface DepotPrice {
  sellPrice?: number;
  adjustType?: PriceAdjustType;
  value?: number;
  /**
   * Wholesale band price for the quantity being ordered (design 16b). An absolute unit
   * price: when present it replaces `sellPrice` AND the rule adjustment for that line.
   */
  tierPrice?: number;
}

/**
 * Reads per-depot resolved prices (static override + the winning active pricing
 * rule) from depot-service. A WARALABA depot may sell a product at its own price
 * and/or have an active dynamic-pricing rule; when neither exists the order-service
 * falls back to the catalog base price with no adjustment. Pricing is non-critical
 * to placing an order, so implementations fail OPEN: any error returns an empty map.
 */
export interface DepotPricingPort {
  /**
   * productId -> resolved price. Absent products use the catalog base price, no
   * adjustment. `quantities` is positional against `productIds` and opts into wholesale
   * band pricing; omit it to price a single unit.
   */
  getPrices(
    depotId: string,
    productIds: string[],
    quantities?: number[],
  ): Promise<DepotPriceLookup>;
}

/**
 * The prices, and whether they are actually the depot's.
 *
 * `unavailable` is the part that used to be missing. Failing open is still the right
 * call — a pricing outage must not stop somebody buying water — but an order billed at
 * catalog prices when the depot sells at its own is a money difference, and it used to
 * leave no trace at all. It surfaces on the order's own timeline and as an alert.
 */
export interface DepotPriceLookup {
  prices: Map<string, DepotPrice>;
  unavailable: boolean;
}
