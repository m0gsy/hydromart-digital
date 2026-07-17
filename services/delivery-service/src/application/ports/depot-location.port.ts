export interface DepotLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/**
 * Reads a depot's coordinates so a courier's check-in can be verified against it.
 * Fails closed: without the depot's position there is no GPS gate, and an
 * unverified check-in opens the settlement window for a courier who may not be
 * at the depot at all.
 */
export interface DepotLocationPort {
  /** Null when the depot exists but has no coordinates recorded. */
  find(depotId: string): Promise<DepotLocation | null>;
}
