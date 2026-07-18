export interface FavoriteRepository {
  /** Product ids the customer has favorited, newest first. */
  listProductIds(customerId: string): Promise<string[]>;
  /** Add a favorite. Idempotent: a duplicate (customerId, productId) is a no-op. */
  add(customerId: string, productId: string): Promise<void>;
  /** Remove a favorite. Idempotent: removing a non-existent favorite is a no-op. */
  remove(customerId: string, productId: string): Promise<void>;
}
