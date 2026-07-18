/**
 * Resolves which depots a franchise owner owns, from depot-service (forecast has no ownership
 * data of its own). Used to reject a forecast query for a depot the caller doesn't own.
 *
 * MUST fail CLOSED: on misconfig, non-2xx, timeout or network error the adapter throws rather
 * than returning an empty/partial list, so an ownership check can never pass by accident.
 */
export interface DepotOwnershipPort {
  ownedDepotIds(ownerId: string): Promise<string[]>;
}
