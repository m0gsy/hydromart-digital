/** The subset of a catalog product the order-service needs to price a line. */
export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  basePrice: number;
  active: boolean;
}

/**
 * Reads authoritative product data from the product-service. Prices are ALWAYS
 * resolved here at checkout — the client-supplied price is never trusted.
 */
export interface ProductCatalogPort {
  /** Returns null when the product does not exist or is inactive. */
  getProduct(productId: string): Promise<CatalogProduct | null>;
}
