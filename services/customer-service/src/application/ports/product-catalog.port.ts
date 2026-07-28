/**
 * Minimal catalog lookup: does this product id exist?
 *
 * Returns `false` ONLY when product-service definitively says the product is unknown.
 * Any other outcome (service unreachable, timeout, 5xx, not configured) returns `true`
 * so a catalog outage never blocks a customer from favouriting a product they can see —
 * this check exists to reject junk ids, not to gate on product-service uptime.
 */
export interface ProductCatalogPort {
  exists(productId: string): Promise<boolean>;
}
