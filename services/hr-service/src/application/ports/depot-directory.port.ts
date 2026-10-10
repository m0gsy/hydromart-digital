export const DEPOT_DIRECTORY_PORT = Symbol('DepotDirectoryPort');

/**
 * What hr-service needs to know about a depot, which it does not keep itself (depot ids are
 * plain UUIDs here, the depots live in depot-service).
 */
export interface DepotDirectoryPort {
  /**
   * Whether the depot exists and is open. THROWS when depot-service cannot answer: "I could
   * not find out" must never read as "it is open" (a person would be sent to a depot nobody
   * checked) or as "it is closed" (a plan refused on a network blip). Callers decide what a
   * failed lookup means; a plan asks the person to try again, the sweep retries next tick.
   */
  isActive(depotId: string): Promise<boolean>;
}
