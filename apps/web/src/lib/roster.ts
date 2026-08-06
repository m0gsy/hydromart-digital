import type { Customer, Delivery } from './types';

/** Active-delivery statuses that count toward a courier's current load. */
const ACTIVE: Delivery['status'][] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

/** A courier's state on the roster. `offshift` is why an assignment would be refused. */
export type RiderState = 'delivering' | 'available' | 'resting' | 'offshift';

export interface RosterRow {
  driver: Customer;
  /** The courier's home depot; `activeDepotId` when they are working elsewhere today. */
  depotId: string | null;
  activeDepotId: string | null;
  load: number;
  state: RiderState;
}

/**
 * Shifts as the dispatch view reports them (delivery-service `GET /shifts`). Only the two
 * fields the roster needs — `acceptsAssignments` is the service's own answer to "may this
 * courier be handed a delivery", so the console never re-derives that rule.
 */
export interface CourierShift {
  driverId: string;
  depotId: string | null;
  status: string;
  acceptsAssignments: boolean;
}

/** Couriers with a shift that is open AND accepting work, by account id. */
export function dispatchableDrivers(shifts: readonly CourierShift[]): Set<string> {
  return new Set(shifts.filter((s) => s.acceptsAssignments).map((s) => s.driverId));
}

/**
 * The roster, joined from three reads that each know only part of the answer.
 *
 * Two things this deliberately does NOT do any more:
 * - it no longer reads the depot off an active delivery alone, which left every idle
 *   courier showing "—" as if they belonged nowhere;
 * - it no longer calls a courier "available" purely because they have no delivery in
 *   flight. Assignment needs an open shift (delivery-service refuses otherwise), so a
 *   courier who has not checked in is `offshift` — the reason, not a false green light.
 */
export function deriveRoster(
  drivers: readonly Customer[],
  deliveries: readonly Delivery[],
  shifts: readonly CourierShift[],
): RosterRow[] {
  const dispatchable = dispatchableDrivers(shifts);
  /*
   * C-7: an OPEN shift, which is not the same question as a DISPATCHABLE one. This used the
   * `acceptsAssignments` predicate, so a courier on BREAK — who has checked in somewhere and
   * is standing in that depot — contributed no depot at all, and the roster showed their home
   * depot while they were at another. `ENDED` is the only state that means they are not
   * anywhere; everything else is somebody at a depot, whether or not they may take work.
   */
  const openShift = new Map(shifts.filter((s) => s.status !== 'ENDED').map((s) => [s.driverId, s]));

  return drivers.map((driver) => {
    const own = deliveries.filter((d) => d.driverId === driver.id && ACTIVE.includes(d.status));
    const onDelivery = own.some((d) => d.status === 'ON_DELIVERY' || d.status === 'PICKED_UP');
    // Where they are working right now, if that is not their home depot.
    const activeDepotId = own.find((d) => d.depotId)?.depotId ?? openShift.get(driver.id)?.depotId ?? null;

    const state: RiderState =
      driver.status !== 'ACTIVE'
        ? 'resting'
        : onDelivery
          ? 'delivering'
          : dispatchable.has(driver.id)
            ? 'available'
            : 'offshift';

    /*
     * C-8: "working away" needs BOTH depots to be known. `activeDepotId !== assignedDepotId`
     * was true when the home depot was simply unrecorded, and the page rendered
     * "— (bertugas di Depot B)" — a courier away from nowhere. With no home to be away from,
     * where they are IS their depot.
     */
    const homeDepotId = driver.assignedDepotId ?? null;
    const away = activeDepotId && homeDepotId && activeDepotId !== homeDepotId;

    return {
      driver,
      depotId: homeDepotId ?? activeDepotId,
      activeDepotId: away ? activeDepotId : null,
      load: own.length,
      state,
    };
  });
}
