/**
 * Resolves the set of customerIds belonging to a depot. Loyalty rows key only on
 * customerId, so depot-scoped aggregates first ask customer-service which customers
 * belong to the depot, then aggregate WHERE customerId IN (ids).
 */
export interface CustomerDirectory {
  /** Fails OPEN: returns [] when the directory is unreachable/unconfigured. */
  customerIdsForDepot(depotId: string): Promise<string[]>;
}
