/**
 * Resolves the customers belonging to a depot (owned by customer-service). Implementations
 * fail OPEN: a customer-service outage yields an empty list, never an error — a depot
 * aggregate degrades to zeros rather than breaking the staff read.
 */
export interface CustomerDirectoryPort {
  customerIdsForDepot(depotId: string): Promise<string[]>;
}
