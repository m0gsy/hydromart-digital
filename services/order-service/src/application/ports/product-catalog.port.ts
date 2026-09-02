/** The subset of a catalog product the order-service needs to price a line. */
export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  /** Fill volume in millilitres (19000 = 19L galon). Null for non-liquid lines. */
  volumeMl: number | null;
  /** Refillable galon line — drives the per-galon delivery fee. */
  isGallon: boolean;
  basePrice: number;
  /**
   * Primary catalogue photo, or null for a product that has none.
   *
   * Carried purely so the CART can show what the shop showed. It was dropped here, so
   * every line in the basket rendered the same grey droplet placeholder — three identical
   * tiles above three different products, on the screen where somebody checks they picked
   * the right thing before paying.
   */
  imageUrl: string | null;
  active: boolean;
}

/**
 * Reads authoritative product data from the product-service. Prices are ALWAYS
 * resolved here at checkout — the client-supplied price is never trusted.
 */
export interface ProductCatalogPort {
  /** Returns null when the product does not exist or is inactive. */
  getProduct(productId: string): Promise<CatalogProduct | null>;
  /**
   * Many products in ONE call (audit S-7). Checkout opened one HTTP request per cart line;
   * they were at least concurrent, but a five-line cart still meant five round-trips and
   * five sockets. Ids the catalog does not have (or has deactivated) are absent from the
   * map, exactly as `getProduct` returns null for them.
   *
   * ponytail: no cache in front of this. The base price it carries is what the customer is
   * charged, and a stale price is a wrong bill — the round-trip is the thing worth removing,
   * not the freshness.
   */
  getProducts(productIds: string[]): Promise<Map<string, CatalogProduct>>;
}
