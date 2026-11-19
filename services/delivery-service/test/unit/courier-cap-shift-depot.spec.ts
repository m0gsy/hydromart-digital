/**
 * Owner decision 2026-11-19: a courier's active-order cap is the cap of the depot they are on
 * SHIFT at.
 *
 * The dispatch view (`canTakeDelivery`) already read the shift depot's cap, but `assign`
 * enforced the cap of the ORDER's depot. A courier lent across depots was shown as free and then
 * refused, or shown as full and then accepted. One rule now, the same on both sides.
 */
import { randomUUID } from 'node:crypto';

import { DeliveryService } from '../../src/application/services/delivery.service';
import { ShiftService } from '../../src/application/services/shift.service';
import type { ShiftQuery } from '../../src/application/ports/shift.repository';
import { DriverBusyError } from '../../src/domain/errors';
import {
  FakeCourierPayout,
  FakeDepotLocation,
  FakeOrderCoordination,
  FakeOrderLookup,
  FakeOrderPayment,
  InMemoryDeliveryRepository,
  InMemoryShiftRepository,
  buildTestConfig,
} from '../support/fakes';

const AUTH = 'Bearer token';
const SHIFT_DEPOT = '00000000-0000-4000-8000-000000000001';
const ORDER_DEPOT = '00000000-0000-4000-8000-000000000002';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };
const driver = randomUUID();
const staff = randomUUID();

async function build(caps: Record<string, number>) {
  const repo = new InMemoryDeliveryRepository();
  const config = buildTestConfig({});
  jest
    .spyOn(config, 'maxActiveDeliveriesPerDriver')
    .mockImplementation((depotId: string | null = null) => caps[depotId ?? ''] ?? 1);
  const depots = new FakeDepotLocation();
  const shifts = new ShiftService(new InMemoryShiftRepository(), repo, depots, config);
  const service = new DeliveryService(
    repo,
    new FakeOrderCoordination(),
    new FakeCourierPayout(),
    shifts,
    config,
    depots,
    new FakeOrderPayment(),
    new FakeOrderLookup(),
  );
  await shifts.checkIn(driver, SHIFT_DEPOT, AT_DEPOT.lat, AT_DEPOT.lng);
  const assign = () =>
    service.assign(
      staff,
      {
        orderId: randomUUID(),
        orderNumber: 'HM-1',
        driverId: driver,
        depotId: ORDER_DEPOT,
        destinationAddress: 'Jl. Merdeka 10',
      },
      AUTH,
    );
  return { shifts, assign, repo };
}

describe('the active-order cap follows the shift depot', () => {
  it('a shift depot that allows two lets a second order in, whatever the order depot allows', async () => {
    const { assign, shifts, repo } = await build({ [SHIFT_DEPOT]: 2, [ORDER_DEPOT]: 1 });
    const write = jest.spyOn(repo, 'createIfUnderCap');
    await assign();
    // The locked write is held to the same cap the pre-check used: the race path matters most.
    expect(write.mock.calls[0]![1]).toBe(2);
    await expect(assign()).resolves.toBeDefined();
    await expect(assign()).rejects.toBeInstanceOf(DriverBusyError);
    // The dispatch view says the same thing the server just did.
    const query: ShiftQuery = { depotId: SHIFT_DEPOT, from: new Date(0) };
    const [row] = await shifts.search(query);
    expect(row).toMatchObject({ maxActiveDeliveries: 2, canTakeDelivery: false });
  });

  it('a shift depot that allows one refuses the second, whatever the order depot allows', async () => {
    const { assign } = await build({ [SHIFT_DEPOT]: 1, [ORDER_DEPOT]: 3 });
    await assign();
    await expect(assign()).rejects.toBeInstanceOf(DriverBusyError);
  });
});
