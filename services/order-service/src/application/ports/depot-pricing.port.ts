/**
 * Reads per-depot product price overrides from the depot-service. A WARALABA depot
 * may sell a product at its own price; when no override exists the order-service
 * falls back to the catalog base price. Pricing is non-critical to placing an order,
 * so implementations fail OPEN: any error returns an empty map (catalog base wins).
 */
export interface DepotPricingPort {
  /** productId -> per-depot unit price (IDR). Absent products use the catalog base price. */
  getPrices(depotId: string, productIds: string[]): Promise<Map<string, number>>;
}
