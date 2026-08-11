import { Holiday, OperatingHours } from '../../domain/opening-hours';

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
  // The three below are what the public projection carries beyond routing and pricing.
  // Optional because a depot legitimately has none of them: nobody has filled the
  // opening-hours form in yet. Absent reads as "always open", never as "shut" — see
  // isOpenAt — so a depot that has not configured hours keeps behaving as it always did.
  /** Depot's own name, for the messages a broadcast or a courier reads. */
  name?: string;
  /** Weekly hours incl. the optional midday break. */
  operatingHours?: OperatingHours;
  /** Dated full-day closures. */
  holidays?: Holiday[];
}

/**
 * Reads active depots (with their service area, fee, and minimum) from the
 * depot-service. Used to stamp the fulfilling depot and price its delivery fee.
 *
 * Returns `null` when the directory is UNREACHABLE, versus a `DepotLocation[]`
 * when it responded — an empty array means the platform simply has no active
 * depots. This lets the caller distinguish a genuine out-of-service-area address
 * (depots exist, none covers it) from an outage. Both now REJECT checkout: an
 * order stamped with no depot is invisible to every queue and reserves no stock,
 * which is worse than asking the customer to try again.
 */
/** Who owns a depot, and whether it is meant to have an owner at all. */
export interface DepotOwnership {
  ownerId: string | null;
  ownershipType: 'WARALABA' | 'HKP';
}

export interface DepotDirectoryPort {
  listActiveDepots(): Promise<DepotLocation[] | null>;
  /**
   * Ownership of one depot, for crediting a completed order. Not part of the public depot
   * projection, so this reads the internal-key route. Null when depot-service is unreachable
   * or the key is unset (caller skips the push). An HKP depot legitimately has no owner; a
   * WARALABA depot with `ownerId: null` is a data defect the caller logs.
   */
  findOwner(depotId: string): Promise<DepotOwnership | null>;
}
