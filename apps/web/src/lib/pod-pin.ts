import type { Delivery } from './types';

/** A pin is "clearly off" past this many metres from where couriers actually handed over. */
export const POD_PIN_OFF_M = 150;
/** Two handovers this close to each other are the same doorstep, not two stray fixes. */
const POD_AGREE_M = 100;

export interface PodPinHint {
  latitude: number;
  longitude: number;
  /** Metres from the current pin; null when the address has no pin to measure from. */
  distanceM: number | null;
  deliveryId: string;
}

/** Great-circle metres between two points (haversine). */
function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** "Jl. Merdeka 10" is the address of "Jl. Merdeka 10, Bandung" — not of "Jl. Merdeka 100". */
function sameStreet(destination: string, line: string): boolean {
  const d = destination.trim().toLowerCase();
  return line !== '' && (d === line || d.startsWith(`${line},`));
}

/**
 * P2-4: where couriers actually handed this address its water, when that is clearly not
 * where its pin is. For a pinned address, the two newest deliveries sent to THIS pin (to
 * 1e-6°) must both have been handed over more than 150 m away, and within 100 m of each
 * other — one stray GPS fix (a coarse fallback, an old build) is not a reason to move a
 * pin. An address with no pin takes the newest proof for an unpinned order to its street:
 * anything is better than no pin. Only a suggestion: staff see it on a map and decide, and
 * the server still checks the area.
 */
export function podPinHint(
  address: { latitude: number | null; longitude: number | null; addressLine: string },
  deliveries: readonly Delivery[],
): PodPinHint | null {
  const newest = deliveries
    .filter((d) => d.status === 'DELIVERED' && d.proof)
    .sort((a, b) => (b.deliveredAt ?? b.assignedAt).localeCompare(a.deliveredAt ?? a.assignedAt));
  const { latitude: lat, longitude: lng } = address;
  if (lat == null || lng == null) {
    const line = address.addressLine.trim().toLowerCase();
    const d = newest.find(
      (x) => x.destinationLat == null && sameStreet(x.destinationAddress, line),
    );
    return d
      ? { latitude: d.proof!.latitude, longitude: d.proof!.longitude, distanceM: null, deliveryId: d.id }
      : null;
  }
  const toThisPin = newest.filter(
    (d) =>
      d.destinationLat != null &&
      d.destinationLng != null &&
      Math.abs(d.destinationLat - lat) <= 1e-6 &&
      Math.abs(d.destinationLng - lng) <= 1e-6,
  );
  const [a, b] = toThisPin;
  if (!a || !b) return null;
  const off = metres(lat, lng, a.proof!.latitude, a.proof!.longitude);
  const agree = metres(a.proof!.latitude, a.proof!.longitude, b.proof!.latitude, b.proof!.longitude);
  const bOff = metres(lat, lng, b.proof!.latitude, b.proof!.longitude);
  return off > POD_PIN_OFF_M && bOff > POD_PIN_OFF_M && agree <= POD_AGREE_M
    ? { latitude: a.proof!.latitude, longitude: a.proof!.longitude, distanceM: Math.round(off), deliveryId: a.id }
    : null;
}
