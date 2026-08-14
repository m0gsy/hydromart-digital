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

/** One active depot's name and its own WhatsApp number (internal-key route). */
export interface DepotContact {
  id: string;
  name: string;
  /** Null = no number of its own; the caller falls back to the HQ ops number. */
  contactPhone: string | null;
}

/** Empties handed back at one depot over a window, in GALLONS (damaged is a subset). */
export interface DepotGallonReturns {
  gallons: number;
  damaged: number;
}

export interface DepotDirectoryPort {
  listActiveDepots(): Promise<DepotLocation[] | null>;
  /**
   * Every active depot with its own phone number, for operational messages addressed to
   * the depot. Read from the internal-key route rather than the public projection: a
   * depot's WhatsApp number belongs to its staff and must not be scrapeable anonymously.
   * Null when depot-service is unreachable or the key is unset.
   */
  listContacts(): Promise<DepotContact[] | null>;
  /**
   * Ownership of one depot, for crediting a completed order. Not part of the public depot
   * projection, so this reads the internal-key route. Null when depot-service is unreachable
   * or the key is unset (caller skips the push). An HKP depot legitimately has no owner; a
   * WARALABA depot with `ownerId: null` is a data defect the caller logs.
   */
  findOwner(depotId: string): Promise<DepotOwnership | null>;
  /**
   * Gallons returned at one depot in [from, to) — the daily report's `gallonsReturned`
   * and `gallonsDamaged`, which order-service cannot know: the return slip is written in
   * depot-service. Null when depot-service is unreachable or the key is unset, so the
   * report can say "—" instead of claiming nothing came back.
   */
  gallonReturns(depotId: string, from: Date, to: Date): Promise<DepotGallonReturns | null>;
}
