import { randomUUID } from 'node:crypto';

import { AuthenticatedUser } from '@hydromart/platform';

import { DeliveryService } from '../../src/application/services/delivery.service';
import { DeliveryController } from '../../src/modules/delivery.controller';
import { ShiftService } from '../../src/application/services/shift.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { DeliveryAlreadyExistsError } from '../../src/domain/errors';
import {
  FakeCourierPayout,
  FakeDepotLocation,
  FakeOrderCoordination,
  FakeOrderPayment,
  InMemoryDeliveryRepository,
  InMemoryShiftRepository,
  buildTestConfig,
} from '../support/fakes';

/*
 * B2 — a delivery in flight has no staff way out.
 *
 * Every escape hatch the domain already allows (ASSIGNED/PICKED_UP/ON_DELIVERY ->
 * FAILED or RESCHEDULED) is keyed to `ownedByDriver`, so only the courier holding the
 * delivery can take it. A courier whose phone dies takes the order with them: it freezes
 * mid-flight, and the stock reserved at checkout stays held behind it.
 *
 * Dispatch cannot route around it either — `assign` refuses while a delivery row exists
 * unless it is RESCHEDULED, and only the courier can put it there.
 */

const AUTH = 'Bearer token';
const DEPOT_ID = '00000000-0000-4000-8000-000000000001';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };

describe('staff can unstick a delivery the courier cannot (B2)', () => {
  let repo: InMemoryDeliveryRepository;
  let orders: FakeOrderCoordination;
  let shifts: ShiftService;
  let service: DeliveryService;
  const driver = randomUUID();
  const otherDriver = randomUUID();

  const staff: AuthenticatedUser = {
    sub: 'staff-1',
    role: 'KEPALA_DEPOT' as never,
    phone: '08',
    depotId: DEPOT_ID,
  };

  beforeEach(async () => {
    repo = new InMemoryDeliveryRepository();
    orders = new FakeOrderCoordination();
    const shiftRepo = new InMemoryShiftRepository();
    const config = buildTestConfig();
    const depots = new FakeDepotLocation();
    shifts = new ShiftService(shiftRepo, repo, depots, config);
    service = new DeliveryService(
      repo,
      orders,
      new FakeCourierPayout(),
      shifts,
      config,
      depots,
      new FakeOrderPayment(),
    );
    await shifts.checkIn(driver, DEPOT_ID, AT_DEPOT.lat, AT_DEPOT.lng);
    await shifts.checkIn(otherDriver, DEPOT_ID, AT_DEPOT.lat, AT_DEPOT.lng);
  });

  /** A delivery the courier picked up and then went dark on. */
  const inFlight = async () => {
    const orderId = randomUUID();
    const delivery = await service.assign(
      staff.sub,
      {
        orderId,
        orderNumber: 'HM-1',
        driverId: driver,
        depotId: DEPOT_ID,
        destinationAddress: 'Jl. Merdeka 10',
      },
      AUTH,
    );
    await service.pickup(driver, delivery.id, AUTH);
    return { delivery, orderId };
  };

  it('today: dispatch cannot route around a frozen delivery at all', async () => {
    const { delivery, orderId } = await inFlight();
    expect((await repo.findById(delivery.id))?.status).toBe(DeliveryStatus.PICKED_UP);

    await expect(
      service.assign(
        staff.sub,
        {
          orderId,
          orderNumber: 'HM-1',
          driverId: otherDriver,
          depotId: DEPOT_ID,
          destinationAddress: 'Jl. Merdeka 10',
        },
        AUTH,
      ),
    ).rejects.toBeInstanceOf(DeliveryAlreadyExistsError);
  });

  it('staff release it back to the queue, and dispatch can then re-assign it', async () => {
    const { delivery, orderId } = await inFlight();

    await service.releaseByStaff(staff, delivery.id, 'HP kurir mati', AUTH);

    expect((await repo.findById(delivery.id))?.status).toBe(DeliveryStatus.RESCHEDULED);
    // The order goes back to the dispatch queue rather than staying pinned to the
    // abandoned attempt's status — the same move the courier's own reschedule makes.
    expect(orders.calls.at(-1)).toMatchObject({ orderId, status: 'PREPARING' });

    const second = await service.assign(
      staff.sub,
      {
        orderId,
        orderNumber: 'HM-1',
        driverId: otherDriver,
        depotId: DEPOT_ID,
        destinationAddress: 'Jl. Merdeka 10',
      },
      AUTH,
    );
    expect(second.driverId).toBe(otherDriver);
  });

  it('staff cancel it outright, which is what gives the held stock back', async () => {
    const { delivery, orderId } = await inFlight();

    await service.cancelByStaff(staff, delivery.id, 'Pesanan dibatalkan pelanggan', AUTH);

    expect((await repo.findById(delivery.id))?.status).toBe(DeliveryStatus.FAILED);
    // order-service releases the checkout hold on CANCELLED; that is the whole point of
    // cancelling rather than releasing — a frozen order holds stock nobody can sell.
    expect(orders.calls.some((c) => c.orderId === orderId && c.status === 'CANCELLED')).toBe(true);
  });

  it('refuses a delivery belonging to another depot', async () => {
    const { delivery } = await inFlight();
    const elsewhere: AuthenticatedUser = { ...staff, depotId: randomUUID() };

    await expect(
      service.releaseByStaff(elsewhere, delivery.id, 'bukan depot saya', AUTH),
    ).rejects.toThrow();
    await expect(
      service.cancelByStaff(elsewhere, delivery.id, 'bukan depot saya', AUTH),
    ).rejects.toThrow();
  });

  /* The default-argument path: an internal caller with no bearer of its own. */
  it('works without a bearer, like every other service-to-service caller', async () => {
    const { delivery } = await inFlight();
    await expect(service.releaseByStaff(staff, delivery.id, 'tanpa token')).resolves.toMatchObject({
      status: DeliveryStatus.RESCHEDULED,
    });
    const second = await inFlight();
    await expect(
      service.cancelByStaff(staff, second.delivery.id, 'tanpa token'),
    ).resolves.toMatchObject({
      status: DeliveryStatus.FAILED,
    });
  });

  it('refuses a delivery that is already finished', async () => {
    const { delivery } = await inFlight();
    await service.cancelByStaff(staff, delivery.id, 'sudah batal', AUTH);

    await expect(service.cancelByStaff(staff, delivery.id, 'lagi', AUTH)).rejects.toThrow();
    await expect(service.releaseByStaff(staff, delivery.id, 'lagi', AUTH)).rejects.toThrow();
  });
});

/*
 * The routes themselves. Kept thin on purpose — everything they decide is decided in the
 * service above — so this asserts only that the controller hands the caller, the reason
 * and the bearer through unchanged. A route that silently dropped the bearer would fail
 * open somewhere far away from here.
 */
describe('DeliveryController staff escape hatches (B2)', () => {
  const id = '00000000-0000-4000-8000-0000000000aa';
  const user = { sub: 'staff-1' } as AuthenticatedUser;
  const deliveries = {
    releaseByStaff: jest.fn().mockResolvedValue({ id }),
    cancelByStaff: jest.fn().mockResolvedValue({ id }),
  };
  const controller = new DeliveryController(deliveries as unknown as DeliveryService);

  it('release passes the caller, the reason and the bearer through', async () => {
    await expect(
      controller.release(user, id, { reason: 'HP kurir mati' } as never, 'Bearer t'),
    ).resolves.toEqual({ id });
    expect(deliveries.releaseByStaff).toHaveBeenCalledWith(user, id, 'HP kurir mati', 'Bearer t');
  });

  it('cancel passes the caller, the reason and the bearer through', async () => {
    await expect(
      controller.cancel(user, id, { reason: 'Pelanggan batal' } as never, 'Bearer t'),
    ).resolves.toEqual({ id });
    expect(deliveries.cancelByStaff).toHaveBeenCalledWith(user, id, 'Pelanggan batal', 'Bearer t');
  });
});
