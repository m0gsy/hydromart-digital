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
  const openShift = new Map(shifts.filter((s) => s.acceptsAssignments).map((s) => [s.driverId, s]));

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

    return {
      driver,
      depotId: driver.assignedDepotId ?? null,
      activeDepotId: activeDepotId && activeDepotId !== driver.assignedDepotId ? activeDepotId : null,
      load: own.length,
      state,
    };
  });
}
