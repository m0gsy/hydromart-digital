import { ForbiddenException } from '@nestjs/common';

import { DeliveryStatus } from '../../src/domain/delivery-status';
import { DeliveryService } from '../../src/application/services/delivery.service';
import { ShiftService } from '../../src/application/services/shift.service';
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

const DEPOT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_DEPOT = '00000000-0000-4000-8000-000000000002';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };
const DRIVER = 'driver-1';
const ORDER = '00000000-0000-4000-8000-0000000000aa';
const AUTH = 'Bearer courier-token';

/**
 * S1 — a courier takes an order nobody claimed.
 *
 * The wait is the whole of the decision and is tested as such: without it the fastest phone
 * wins every order the instant it is confirmed, and the dispatcher who was about to assign
 * it deliberately loses the race.
 */
describe('DeliveryService.claimByDriver (S1)', () => {
  let repo: InMemoryDeliveryRepository;
  let lookup: FakeOrderLookup;
  let orders: FakeOrderCoordination;

  /** `enabled`/`waitMinutes` arrive as settings rows, because neither has an env var. */
  async function make(enabled: number, waitMinutes = 10) {
    repo = new InMemoryDeliveryRepository();
    orders = new FakeOrderCoordination();
    lookup = new FakeOrderLookup();
    const config = buildTestConfig({}, [
      { scope: 'GLOBAL', depotId: null, key: 'courierSelfClaimEnabled', value: String(enabled) },
      {
        scope: 'GLOBAL',
        depotId: null,
        key: 'courierSelfClaimWaitMinutes',
        value: String(waitMinutes),
      },
    ]);
    const depots = new FakeDepotLocation();
    const shifts = new ShiftService(new InMemoryShiftRepository(), repo, depots, config);
    const service = new DeliveryService(
      repo,
      orders,
      new FakeCourierPayout(),
      shifts,
      config,
      depots,
      new FakeOrderPayment(),
      lookup,
    );
    await shifts.checkIn(DRIVER, DEPOT_ID, AT_DEPOT.lat, AT_DEPOT.lng);
    return service;
  }

  it('hands the courier the same delivery a dispatcher would have created', async () => {
    const service = await make(1);
    lookup.seed({ id: ORDER, depotId: DEPOT_ID });

    const delivery = await service.claimByDriver(DRIVER, ORDER, AUTH);

    expect(delivery).toMatchObject({
      orderId: ORDER,
      driverId: DRIVER,
      depotId: DEPOT_ID,
      status: DeliveryStatus.ASSIGNED,
    });
    // It writes nothing of its own — the order was advanced by `assign`, once.
    expect(orders.calls).toEqual([{ orderId: ORDER, status: 'DRIVER_ASSIGNED' }]);
    // …and the delivery carries what the courier hands over, not the catalogue row.
    expect(delivery.items).toEqual([{ name: 'Galon 19L', qty: 2 }]);
  });

  /*
   * Born DEAD. Shipping a new way to claim work switched on by default changes how a depot
   * dispatches before anybody there has agreed to it.
   */
  it('refuses everybody until a depot turns it on', async () => {
    const service = await make(0);
    lookup.seed({ id: ORDER, depotId: DEPOT_ID });
    await expect(service.claimByDriver(DRIVER, ORDER, AUTH)).rejects.toMatchObject({
      code: 'DELIVERY_SELF_CLAIM_DISABLED',
      status: 403,
    });
  });

  it('refuses an order that has not sat there long enough yet', async () => {
    const service = await make(1, 10);
    lookup.seed({ id: ORDER, depotId: DEPOT_ID, statusChangedAt: new Date(Date.now() - 60_000) });
    await expect(service.claimByDriver(DRIVER, ORDER, AUTH)).rejects.toMatchObject({
      code: 'DELIVERY_SELF_CLAIM_TOO_SOON',
      status: 409,
    });
    expect(repo.rows).toHaveLength(0);
  });

  /*
   * ANY row refuses, which is stricter than `assign` and deliberately so. `assign` re-opens
   * a RESCHEDULED delivery because a dispatcher doing that is making a decision about a
   * promise already given to a customer. A courier claiming it is not: `rescheduledFor` is
   * never cleared by anybody, so the claim would silently throw away a date somebody was
   * told to expect. The same line refuses a FAILED row, and refuses re-attaching COD on top
   * of money that has already been reversed.
   */
  it.each([DeliveryStatus.RESCHEDULED, DeliveryStatus.FAILED, DeliveryStatus.ASSIGNED])(
    'refuses an order that already has a %s delivery row',
    async (status) => {
      const service = await make(1);
      const order = lookup.seed({ id: ORDER, depotId: DEPOT_ID });
      const existing = await repo.create({
        orderId: order.id,
        orderNumber: order.orderNumber,
        driverId: 'somebody-else',
        depotId: DEPOT_ID,
        destinationAddress: 'Jl. Air 1',
        destinationLat: null,
        destinationLng: null,
        recipientPhone: null,
        customerId: null,
        items: null,
        codAmount: null,
        notes: null,
        deliveryWindow: null,
      });
      if (status !== DeliveryStatus.ASSIGNED) {
        await repo.applyStatus(existing.id, existing.status, status, {}, null, null);
      }

      await expect(service.claimByDriver(DRIVER, ORDER, AUTH)).rejects.toMatchObject({
        code: 'DELIVERY_ALREADY_EXISTS',
        status: 409,
      });
    },
  );

  // An order with no coordinates, no note and no window is the ordinary case for a walk-up
  // depot order, and every one of those is a separate `?? undefined` on the way to `assign`.
  it('claims an order that carries none of the optional fields', async () => {
    const service = await make(1);
    lookup.seed({
      id: ORDER,
      depotId: null,
      latitude: null,
      longitude: null,
      notes: null,
      deliveryWindow: null,
      items: [],
    });
    const delivery = await service.claimByDriver(DRIVER, ORDER, AUTH);
    expect(delivery).toMatchObject({ orderId: ORDER, depotId: null, notes: null });
  });

  it('refuses an order that is not confirmed, and one that does not exist', async () => {
    const service = await make(1);
    lookup.seed({ id: ORDER, depotId: DEPOT_ID, status: 'DELIVERED' });
    await expect(service.claimByDriver(DRIVER, ORDER, AUTH)).rejects.toMatchObject({
      code: 'DELIVERY_ORDER_NOT_CLAIMABLE',
      status: 409,
    });
    await expect(service.claimByDriver(DRIVER, 'missing', AUTH)).rejects.toMatchObject({
      code: 'DELIVERY_ORDER_NOT_CLAIMABLE',
    });
  });

  /*
   * The depot gate is order-service's, not a second copy here: `GET /orders/manage/:id` is
   * `@Can('orderQueue')` — which includes STAFF_DEPOT — followed by `assertDepotAccess`. A
   * 403 means "not your depot", and it must not be reported as a lost race.
   */
  it('lets order-service refuse another depot’s order, and does not call it a lost race', async () => {
    const service = await make(1);
    lookup.seed({ id: ORDER, depotId: OTHER_DEPOT });
    lookup.forbid = true;
    await expect(service.claimByDriver(DRIVER, ORDER, AUTH)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /*
   * The one that used to read "Please try again" in English on an Indonesian screen. Every
   * order-sync failure came back as `OrderCoordinationError`, so the courier who lost a
   * race by half a second was told to retry something that will never succeed — while the
   * one whose signal dropped was told the same thing about something that would.
   */
  it('answers the loser of a race with 409, and a network wobble with 422', async () => {
    const service = await make(1);
    lookup.seed({ id: ORDER, depotId: DEPOT_ID });

    orders.failNext = Object.assign(new Error('order-service responded 409'), { refused: true });
    await expect(service.claimByDriver(DRIVER, ORDER, AUTH)).rejects.toMatchObject({
      code: 'DELIVERY_ORDER_ALREADY_CLAIMED',
      status: 409,
    });

    orders.failNext = new Error('ECONNRESET');
    await expect(service.claimByDriver(DRIVER, ORDER, AUTH)).rejects.toMatchObject({
      code: 'DELIVERY_ORDER_SYNC_FAILED',
      status: 422,
    });
  });
});
