/** The subset of a depot the order-service needs to route + price an order at checkout. */
export interface DepotLocation {
  id: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  /** The fulfilling depot's flat delivery fee (IDR). Overrides the flat config fee. */
  deliveryFee: number;
  /** Minimum order subtotal (IDR) the depot accepts, or null for no minimum. */
  minOrderAmount: number | null;
}

/**
 * Reads active depots (with their service area, fee, and minimum) from the
 * depot-service. Used to stamp the fulfilling depot and price its delivery fee;
 * routing itself is advisory, so implementations fail OPEN (return []) rather
 * than block checkout when the depot-service is down.
 */
export interface DepotDirectoryPort {
  listActiveDepots(): Promise<DepotLocation[]>;
}
