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
 * depot-service. Used to stamp the fulfilling depot and price its delivery fee.
 *
 * Returns `null` when the directory is UNREACHABLE (checkout stays fail-open and
 * unrouted), versus a `DepotLocation[]` when it responded — an empty array means
 * the platform simply has no active depots. This lets the caller distinguish a
 * genuine out-of-service-area address (depots exist, none covers it) from an
 * outage, which must never block checkout.
 */
export interface DepotDirectoryPort {
  listActiveDepots(): Promise<DepotLocation[] | null>;
}
