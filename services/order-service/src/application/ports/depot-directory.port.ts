/** The subset of a depot the order-service needs to route an order at checkout. */
export interface DepotLocation {
  id: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
}

/**
 * Reads active depots (with their service area) from the depot-service. Used only
 * to stamp the fulfilling depot on an order; it is advisory, so implementations
 * fail OPEN (return []) rather than block checkout when the depot-service is down.
 */
export interface DepotDirectoryPort {
  listActiveDepots(): Promise<DepotLocation[]>;
}
