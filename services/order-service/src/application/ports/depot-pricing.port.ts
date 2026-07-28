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
  ): Promise<Map<string, DepotPrice>>;
}
