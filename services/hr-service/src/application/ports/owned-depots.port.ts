export const OWNED_DEPOTS_PORT = Symbol('OwnedDepotsPort');

/**
 * The depots a franchise owner owns. hr-service does not keep this: `Depot.ownerId` lives in
 * depot-service, and it is the only source of truth for "whose depot is this".
 */
export interface OwnedDepotsPort {
  /**
   * Depot ids owned by `ownerId`. THROWS when depot-service cannot answer: "I could not find
   * out" must never read as "owns nothing" (a screen that quietly shows an empty roster) or,
   * worse, as "owns everything". The caller turns a failure into 503.
   */
  depotIdsOf(ownerId: string): Promise<string[]>;
}
