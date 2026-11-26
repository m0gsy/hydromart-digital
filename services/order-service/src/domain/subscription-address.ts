import type { DepotLocation } from '../application/ports/depot-directory.port';
import type { DeliveryAddressSnapshot } from '../application/ports/order.repository';
import { selectNearestDepot } from './geo';

const SNAPSHOT_KEYS = [
  'recipientName',
  'phone',
  'addressLine',
  'city',
  'province',
  'postalCode',
  'latitude',
  'longitude',
  'notes',
] as const;

/** Every field the courier and the routing read; equal snapshots need no write. */
export function sameSnapshot(a: DeliveryAddressSnapshot, b: DeliveryAddressSnapshot): boolean {
  return SNAPSHOT_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/**
 * P3-5: the address a due plan is delivered to: its snapshot, or the saved address it follows when
 * the same depot still serves that one. PURE: the sweep writes the follow afterwards, and the
 * reminder filter (HD-14) reads the same answer without writing, so the two cannot disagree about
 * which depot a plan belongs to. Never to another depot, nor out of an area no depot serves any
 * more (that is the reroute preview's to say); only a plan with no pin of its own — written before
 * pins were required — has no depot to leave, and may take the pinned edit.
 */
export function addressToDeliver(
  followsSaved: boolean,
  snapshot: DeliveryAddressSnapshot,
  fresh: DeliveryAddressSnapshot | null,
  depots: readonly DepotLocation[] | null,
): DeliveryAddressSnapshot {
  if (!followsSaved || !depots?.length || !fresh) return snapshot;
  if (fresh.latitude == null || fresh.longitude == null || sameSnapshot(fresh, snapshot)) {
    return snapshot;
  }
  const after = selectNearestDepot(fresh.latitude, fresh.longitude, depots as DepotLocation[])?.id ?? null;
  if (after === null) return snapshot;
  if (snapshot.latitude != null && snapshot.longitude != null) {
    const before = selectNearestDepot(snapshot.latitude, snapshot.longitude, depots as DepotLocation[])?.id;
    if (before !== after) return snapshot;
  }
  return fresh;
}

/** The depot an address routes to, or null (no pin, or no depot serves it). */
export function routedDepot(
  address: Pick<DeliveryAddressSnapshot, 'latitude' | 'longitude'>,
  depots: readonly DepotLocation[] | null,
): DepotLocation | null {
  if (address.latitude == null || address.longitude == null || !depots?.length) return null;
  return selectNearestDepot(address.latitude, address.longitude, depots as DepotLocation[]);
}
