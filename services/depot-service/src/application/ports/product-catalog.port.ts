/**
 * Read-only window onto the product catalog (product-service).
 *
 * depot-service owns stock, product-service owns what a product IS. Until now the two
 * never spoke, so a stock line could name a product that did not exist and copy a name
 * that later changed. This port is the one place depot-service asks.
 *
 * The three-way result is deliberate. A lookup that failed because the catalog is down
 * must NOT read the same as a lookup that failed because the product is not there: the
 * first has to fail open (a stock line is worth more than a name), the second has to be
 * refused (a line pointing at nothing is a line that can never be sold from).
 */
export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  active: boolean;
}

export type CatalogLookup =
  | { status: 'found'; product: CatalogProduct }
  | { status: 'missing' }
  | { status: 'unavailable' };

export interface ProductCatalogPort {
  /** Resolve one product by id. Never throws — transport failure is `unavailable`. */
  find(productId: string): Promise<CatalogLookup>;
}
