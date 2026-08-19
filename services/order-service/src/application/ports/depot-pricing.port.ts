import { DepotPrice } from '../../domain/pricing';

// The shape moved into the domain when the cart and checkout started sharing one
// pricing function (A1); re-exported here so the port's own callers are unchanged.
export type { DepotPrice };

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
