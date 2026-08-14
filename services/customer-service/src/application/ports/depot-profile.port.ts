/** Where a depot is and how far it will deliver — the two numbers an address is judged against. */
export interface DepotGeo {
  lat: number;
  lng: number;
  serviceRadiusKm: number;
}

/**
 * What depot-service knows about a depot beyond its gallon ledger, for the depot CRM
 * screens (S2). Kept apart from `DepotLedgerPort` because that one answers about money
 * owed; these two answer about the depot itself and about who subscribes to it.
 *
 * Both return `null` on failure — never `{}` or `[]`. "This depot has no subscribers" and
 * "depot-service did not answer" are different sentences, and the second one must not be
 * printed as the first on a screen a manager makes calls from.
 */
export interface DepotProfilePort {
  /** Location + service radius. Null when depot-service is unreachable or the depot is gone. */
  geo(depotId: string): Promise<DepotGeo | null>;
  /**
   * Customer ids holding an ACTIVE subscription at this depot. Only rows linked to an
   * account: a subscription typed in as a free-text name is one nobody linked, not one
   * that does not exist.
   */
  subscriberIds(depotId: string): Promise<string[] | null>;
}
