/** The catalog fields a depot stock line copies when it is opened. */
export interface ProductChanged {
  productId: string;
  name: string;
  unit: string;
  active: boolean;
}

/**
 * Tells depot-service that a product it may hold stock lines for has changed.
 *
 * This is the catalog's only outbound dependency, and it exists because stock lines copy
 * the product's name: without a push, a rename left every depot showing a name the
 * catalog had already stopped using. Deactivation travels the same way, so lines for a
 * product nobody sells stop appearing on the operator's list.
 *
 * Implementations MUST NOT throw. A depot-service outage cannot be allowed to fail a
 * catalog edit — the edit is the source of truth, and the push is best-effort.
 */
export interface StockNotifierPort {
  productChanged(change: ProductChanged): Promise<void>;
}
