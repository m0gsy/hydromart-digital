import { PriceAdjustType } from '../../domain/pricing';

/** A depot's resolved pricing for one product: optional override + optional active rule. */
export interface DepotPrice {
  sellPrice?: number;
  adjustType?: PriceAdjustType;
  value?: number;
}

/**
 * Reads per-depot resolved prices (static override + the winning active pricing
 * rule) from depot-service. A WARALABA depot may sell a product at its own price
 * and/or have an active dynamic-pricing rule; when neither exists the order-service
 * falls back to the catalog base price with no adjustment. Pricing is non-critical
 * to placing an order, so implementations fail OPEN: any error returns an empty map.
 */
export interface DepotPricingPort {
  /** productId -> resolved price. Absent products use the catalog base price, no adjustment. */
  getPrices(depotId: string, productIds: string[]): Promise<Map<string, DepotPrice>>;
}
