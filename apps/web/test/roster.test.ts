import { describe, expect, it } from 'vitest';

import {
  deriveRoster,
  dispatchableDrivers,
  type CourierShift,
  type RosterRow,
} from '@/lib/roster';
import type { Customer, Delivery } from '@/lib/types';

const DEPOT_A = 'depot-a';
const DEPOT_B = 'depot-b';

const driver = (over: Partial<Customer> = {}): Customer =>
  ({
    id: 'drv-1',
    phone: '+628110000001',
    fullName: 'Kurir Satu',
    role: 'STAFF_DEPOT',
    status: 'ACTIVE',
    assignedDepotId: DEPOT_A,
    ...over,
  }) as Customer;

const delivery = (over: Partial<Delivery> = {}): Delivery =>
  ({
    id: 'dlv-1',
    driverId: 'drv-1',
    depotId: DEPOT_A,
    status: 'ASSIGNED',
    ...over,
  }) as Delivery;

const shift = (over: Partial<CourierShift> = {}): CourierShift => ({
  driverId: 'drv-1',
  depotId: DEPOT_A,
  status: 'ONLINE',
  acceptsAssignments: true,
  ...over,
});

const one = (
  drivers: readonly Customer[],
  deliveries: readonly Delivery[],
  shifts: readonly CourierShift[],
): RosterRow => deriveRoster(drivers, deliveries, shifts)[0] as RosterRow;

describe('deriveRoster', () => {
  // The bug: the depot came off an ACTIVE delivery, so an idle courier belonged nowhere.
  it('shows an idle courier their home depot instead of a dash', () => {
    const row = one([driver()], [], [shift()]);
    expect(row.depotId).toBe(DEPOT_A);
    expect(row.activeDepotId).toBeNull();
    expect(row.state).toBe('available');
  });

  it('names the depot a courier is working at when it is not their own', () => {
    const row = one(
      [driver()],
      [delivery({ depotId: DEPOT_B, status: 'ON_DELIVERY' })],
      [shift({ depotId: DEPOT_B })],
    );
    expect(row.depotId).toBe(DEPOT_A);
    expect(row.activeDepotId).toBe(DEPOT_B);
    expect(row.state).toBe('delivering');
    expect(row.load).toBe(1);
  });

  // The one behind "sudah dibuat lewat HR, tapi tetap tidak bisa di-assign": with no open
  // shift delivery-service refuses the assignment, so the roster must not show a green
  // light it cannot honour.
  it('marks a courier who has not checked in as offshift, not available', () => {
    expect(one([driver()], [], []).state).toBe('offshift');
  });

  it('treats a shift that is open but not accepting work as offshift too', () => {
    const row = one([driver()], [], [shift({ status: 'BREAK', acceptsAssignments: false })]);
    expect(row.state).toBe('offshift');
  });

  it('counts only in-flight deliveries as load, and ignores another courier rows', () => {
    const row = one(
      [driver()],
      [
        delivery({ id: 'a', status: 'ASSIGNED' }),
        delivery({ id: 'b', status: 'DELIVERED' }),
        delivery({ id: 'c', driverId: 'drv-2', status: 'ASSIGNED' }),
      ],
      [shift()],
    );
    expect(row.load).toBe(1);
  });

  it('calls a non-active account resting whatever their shift says', () => {
    expect(one([driver({ status: 'SUSPENDED' })], [], [shift()]).state).toBe('resting');
  });

  it('keeps a courier with no home depot on the roster rather than dropping them', () => {
    const row = one([driver({ assignedDepotId: null })], [], []);
    expect(row.depotId).toBeNull();
    expect(row.state).toBe('offshift');
  });
});

describe('dispatchableDrivers', () => {
  it('is exactly the set the service would accept an assignment for', () => {
    const set = dispatchableDrivers([
      shift(),
      shift({ driverId: 'drv-2', acceptsAssignments: false }),
    ]);
    expect([...set]).toEqual(['drv-1']);
  });
});
