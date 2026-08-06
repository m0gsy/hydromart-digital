/**
 * The one thing order-service tells customer-service about a customer: where they bought.
 *
 * §I. A depot's customer directory reads `customer_profiles.favoriteDepotId`, and that
 * column was written by exactly two things — the depot's Excel import and a `PATCH /profile`
 * the console never calls. So somebody who registered themselves and ordered ten times from
 * one depot did not appear in that depot's directory at all. Checkout is the moment the
 * relationship actually exists, and this is where it gets recorded.
 *
 * Fails OPEN, and the far side only writes when there is no favourite yet: the order has
 * already been placed and paid for, and a directory entry is not worth unwinding it over.
 */
export interface CustomerDirectoryPort {
  /**
   * Record `depotId` as this customer's depot when they have none.
   *
   * Resolves to `true` only when it wrote. Never throws — a failure is logged and the
   * checkout carries on.
   */
  claimFavoriteDepot(customerId: string, depotId: string): Promise<boolean>;
}
