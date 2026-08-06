import { randomUUID } from 'node:crypto';

import { DeliveryService, storageKeyFromUrl } from '../../src/application/services/delivery.service';
import { ShiftService } from '../../src/application/services/shift.service';
import {
  DeliveryAlreadyExistsError,
  DeliveryNotActiveError,
  DeliveryNotFoundError,
  DriverBusyError,
  DriverNotOnShiftError,
  InvalidDeliveryTransitionError,
  NoShowNotEligibleError,
  NotAssignedDriverError,
  OrderCoordinationError,
  StaleCaptureError,
} from '../../src/domain/errors';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { haversineMeters } from '../../src/domain/geo';
import { ContactMethod } from '../../src/domain/no-show';
import { ShiftStatus } from '../../src/domain/shift';
import {
  FakeDepotLocation,
  FakeCourierPayout,
  FakeOrderCoordination,
  InMemoryDeliveryRepository,
  InMemoryShiftRepository,
  buildTestConfig,
} from '../support/fakes';

const AUTH = 'Bearer token';
const PROOF = {
  // Shaped like a real stored proof: the storage key is the `pod/...` tail of the URL.
  photoUrl: 'https://cdn/pod/x.jpg',
  signatureUrl: 'https://cdn/pod/sig.png',
  recipientName: 'Budi',
  latitude: -6.9147,
  longitude: 107.6098,
  note: null,
};

// The depot fixture FakeDepotLocation sits at — check-in must be within radius.
const DEPOT_ID = '00000000-0000-4000-8000-000000000001';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };

describe('DeliveryService', () => {
  let repo: InMemoryDeliveryRepository;
  let orders: FakeOrderCoordination;
  let payout: FakeCourierPayout;
  let shifts: ShiftService;
  let service: DeliveryService;
  let storage: { put: jest.Mock; remove: jest.Mock };
  /** Same wiring as `service`, minus the storage binding (an environment with uploads off). */
  let makeStorageless: () => DeliveryService;
  let events: { publish: jest.Mock };
  let urbanSpeedKmph: number;
  const driver = randomUUID();
  const staff = randomUUID();

  beforeEach(async () => {
    repo = new InMemoryDeliveryRepository();
    orders = new FakeOrderCoordination();
    const config = buildTestConfig({ DELIVERY_URBAN_SPEED_KMPH: '30' });
    urbanSpeedKmph = config.urbanSpeedKmph();
    const depots = new FakeDepotLocation();
    shifts = new ShiftService(new InMemoryShiftRepository(), depots, config);
    payout = new FakeCourierPayout();
    storage = { put: jest.fn(), remove: jest.fn().mockResolvedValue(undefined) };
    makeStorageless = () =>
      new DeliveryService(repo, orders, new FakeCourierPayout(), shifts, config, depots);
    events = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new DeliveryService(
      repo,
      orders,
      payout,
      shifts,
      config,
      depots,
      storage as never,
      events as never,
    );
    // Assignment now requires an open ONLINE shift, so every driver clocks in first.
    await shifts.checkIn(driver, DEPOT_ID, AT_DEPOT.lat, AT_DEPOT.lng);
  });

  afterEach(() => jest.useRealTimers());

  const assign = (driverId = driver, orderId = randomUUID()) =>
    service.assign(
      staff,
      { orderId, orderNumber: 'HM-1', driverId, destinationAddress: 'Jl. Merdeka 10' },
      AUTH,
    );


  // Defaults nobody passes in the happy-path specs: the courier app omits the note, and the
  // internal callers (offline flush, ops tooling) carry no bearer at all.
  it('fails a delivery with no caller token and records a contact attempt with no note', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    const state = await service.recordContactAttempt(driver, d.id, ContactMethod.CALL);
    expect(state.attempts).toBe(1);

    const failed = await service.fail(driver, d.id, 'alamat tidak ditemukan');
    expect(failed.status).toBe(DeliveryStatus.FAILED);
  });

  it('reschedules without a caller token', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    const rescheduled = await service.reschedule(driver, d.id, {
      rescheduledFor: new Date('2026-08-02T02:00:00.000Z'),
    });
    expect(rescheduled.status).toBe(DeliveryStatus.RESCHEDULED);
  });

  it('assigns a driver and advances the order to DRIVER_ASSIGNED', async () => {
    const d = await assign();
    expect(d.status).toBe(DeliveryStatus.ASSIGNED);
    expect(orders.calls).toEqual([{ orderId: d.orderId, status: 'DRIVER_ASSIGNED' }]);
  });

  it('snapshots recipient phone, line-items and COD amount onto the delivery', async () => {
    const d = await service.assign(
      staff,
      {
        orderId: randomUUID(),
        orderNumber: 'HM-2',
        driverId: driver,
        destinationAddress: 'Jl. Merdeka 10',
        recipientPhone: '081234567890',
        items: [{ name: 'Galon 19L', qty: 2 }],
        codAmount: 84000,
      },
      AUTH,
    );
    expect(d.recipientPhone).toBe('081234567890');
    expect(d.items).toEqual([{ name: 'Galon 19L', qty: 2 }]);
    expect(d.codAmount).toBe(84000);
  });

  it('leaves snapshot fields null when the assign call omits them', async () => {
    const d = await assign();
    expect(d.recipientPhone).toBeNull();
    expect(d.items).toBeNull();
    expect(d.codAmount).toBeNull();
  });

  it('forwards the courier name + phone to order-service at DRIVER_ASSIGNED', async () => {
    await service.assign(
      staff,
      {
        orderId: randomUUID(),
        orderNumber: 'HM-3',
        driverId: driver,
        destinationAddress: 'Jl. Merdeka 10',
        driverName: 'Budi',
        driverPhone: '081298765432',
      },
      AUTH,
    );
    expect(orders.calls[0]).toMatchObject({
      status: 'DRIVER_ASSIGNED',
      meta: { driverName: 'Budi', driverPhone: '081298765432' },
    });
  });

  it('computes an ETA at ON_DELIVERY start and pushes it onto the order payload', async () => {
    const d = await service.assign(
      staff,
      {
        orderId: randomUUID(),
        orderNumber: 'HM-4',
        driverId: driver,
        destinationAddress: 'Jl. Jauh',
        destinationLat: -6.85,
        destinationLng: 107.7,
        depotId: DEPOT_ID,
      },
      AUTH,
    );
    await service.pickup(driver, d.id, AUTH);
    const started = await service.start(driver, d.id, AUTH);
    expect(started.estimatedArrivalAt).toBeInstanceOf(Date);
    expect(started.estimatedArrivalAt!.getTime()).toBeGreaterThan(Date.now());
    const onDelivery = orders.calls.find((c) => c.status === 'ON_DELIVERY');
    expect(onDelivery?.meta?.estimatedArrivalAt).toBeInstanceOf(Date);
  });

  it('leaves the ETA unset (graceful) when the destination has no coordinates', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    const started = await service.start(driver, d.id, AUTH);
    expect(started.estimatedArrivalAt).toBeNull();
    const onDelivery = orders.calls.find((c) => c.status === 'ON_DELIVERY');
    expect(onDelivery?.meta).toBeUndefined();
  });

  it('rejects a second delivery for the same order', async () => {
    const orderId = randomUUID();
    await assign(driver, orderId);
    await expect(assign(randomUUID(), orderId)).rejects.toBeInstanceOf(DeliveryAlreadyExistsError);
  });

  it('re-assigns a RESCHEDULED delivery for a second attempt instead of refusing it', async () => {
    // Reschedule keeps the order alive on purpose, but the row was terminal AND the
    // duplicate guard refused a fresh assignment, so a rescheduled order could never be
    // delivered by anyone. The retry reuses the row (orderId is unique).
    const orderId = randomUUID();
    const first = await assign(driver, orderId);
    const rescheduled = await service.reschedule(driver, first.id, {
      rescheduledFor: new Date(Date.now() + 86_400_000),
      authorization: AUTH,
    });
    expect(rescheduled.status).toBe(DeliveryStatus.RESCHEDULED);
    // The order goes back to the dispatch queue rather than staying on the abandoned attempt.
    expect(orders.calls.at(-1)).toMatchObject({ status: 'PREPARING' });

    const other = randomUUID();
    await shifts.checkIn(other, DEPOT_ID, AT_DEPOT.lat, AT_DEPOT.lng);
    const retry = await service.assign(
      staff,
      { orderId, orderNumber: 'HM-1', driverId: other, destinationAddress: 'Jl. Merdeka 10' },
      AUTH,
    );

    expect(retry.id).toBe(first.id);
    expect(retry.status).toBe(DeliveryStatus.ASSIGNED);
    expect(retry.driverId).toBe(other);
    // The second attempt starts clean: no leftover pickup/start stamps from the first.
    expect(retry.pickedUpAt).toBeNull();
    expect(retry.startedAt).toBeNull();
    // And it can actually be driven to completion now.
    await service.pickup(other, retry.id, AUTH);
    const started = await service.start(other, retry.id, AUTH);
    expect(started.status).toBe(DeliveryStatus.ON_DELIVERY);
  });

  it('still refuses a second delivery when the first one is DELIVERED', async () => {
    const orderId = randomUUID();
    const d = await assign(driver, orderId);
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    await service.complete(driver, d.id, { photoUrl: 'u', recipientName: 'Budi', signatureUrl: null, latitude: -6.19, longitude: 106.84, note: null }, AUTH);
    await expect(assign(randomUUID(), orderId)).rejects.toBeInstanceOf(DeliveryAlreadyExistsError);
  });

  it('enforces one active delivery per driver (BR)', async () => {
    await assign(driver);
    await expect(assign(driver)).rejects.toBeInstanceOf(DriverBusyError);
  });

  it('refuses to assign a driver who has not checked in', async () => {
    await expect(assign(randomUUID())).rejects.toBeInstanceOf(DriverNotOnShiftError);
  });

  it('refuses to assign a driver who is on a break', async () => {
    const shift = (await shifts.current(driver))!;
    await shifts.setStatus(driver, shift.id, ShiftStatus.BREAK);
    await expect(assign(driver)).rejects.toBeInstanceOf(DriverNotOnShiftError);
  });

  it('refuses to assign a driver who has checked out', async () => {
    const shift = (await shifts.current(driver))!;
    await shifts.checkOut(driver, shift.id, AT_DEPOT.lat, AT_DEPOT.lng);
    await expect(assign(driver)).rejects.toBeInstanceOf(DriverNotOnShiftError);
  });

  // Audit S-17 and its Q-17 baseline row: a ping reads a projection, never the delivery's
  // full history and proof. Pinned by the fake, which only returns the ping columns.
  it('a ping does not load the history', async () => {
    const d = await assign();
    repo.pingStateCalls = 0;
    await service.reportLocation(driver, d.id, -6.2, 106.8);
    expect(repo.pingStateCalls).toBe(1);
  });

  // The ping projection carries its own guards now, so each has to be proved on it: a
  // delivery that does not exist, and one that belongs to another driver.
  it('refuses a ping for an unknown delivery or another driver', async () => {
    const d = await assign();
    await expect(
      service.reportLocation(driver, randomUUID(), -6.2, 106.8),
    ).rejects.toBeInstanceOf(DeliveryNotFoundError);
    await expect(service.reportLocation(randomUUID(), d.id, -6.2, 106.8)).rejects.toBeInstanceOf(
      NotAssignedDriverError,
    );
  });

  it('records the driver location while active and rejects it after delivery', async () => {
    const d = await assign();
    const pinged = await service.reportLocation(driver, d.id, -6.2, 106.8);
    expect(pinged).toMatchObject({ lastLat: -6.2, lastLng: 106.8 });
    expect(pinged.lastLocationAt).toBeInstanceOf(Date);

    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    await service.complete(driver, d.id, PROOF, AUTH);

    await expect(service.reportLocation(driver, d.id, -6.3, 106.9)).rejects.toBeInstanceOf(
      DeliveryNotActiveError,
    );
  });

  it('refreshes ETA from every valid location ping using the configured urban speed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T03:00:00.000Z'));
    const destination = { lat: -6.9, lng: 107.62 };
    const d = await service.assign(
      staff,
      {
        orderId: randomUUID(),
        orderNumber: 'HM-ETA',
        driverId: driver,
        destinationAddress: 'Jl. Tujuan',
        destinationLat: destination.lat,
        destinationLng: destination.lng,
      },
      AUTH,
    );

    const firstOrigin = { lat: -6.95, lng: 107.55 };
    const first = await service.reportLocation(driver, d.id, firstOrigin.lat, firstOrigin.lng);
    const expectedFirst = new Date(
      Date.now() +
        (haversineMeters(firstOrigin.lat, firstOrigin.lng, destination.lat, destination.lng) /
          ((urbanSpeedKmph * 1000) / 60)) *
          60_000,
    );
    expect(first.estimatedArrivalAt).toEqual(expectedFirst);

    jest.advanceTimersByTime(60_000);
    const secondOrigin = { lat: -6.91, lng: 107.61 };
    const second = await service.reportLocation(driver, d.id, secondOrigin.lat, secondOrigin.lng);
    const expectedSecond = new Date(
      Date.now() +
        (haversineMeters(secondOrigin.lat, secondOrigin.lng, destination.lat, destination.lng) /
          ((urbanSpeedKmph * 1000) / 60)) *
          60_000,
    );
    expect(second.estimatedArrivalAt).toEqual(expectedSecond);
    expect(second.estimatedArrivalAt).not.toEqual(first.estimatedArrivalAt);
  });

  it.each([null, new Date('2026-07-22T04:00:00.000Z')])(
    'leaves ETA %s unchanged when destination coordinates are absent',
    async (existingEta) => {
      const d = await assign();
      repo.rows.find((row) => row.id === d.id)!.estimatedArrivalAt = existingEta;

      const pinged = await service.reportLocation(driver, d.id, -6.2, 106.8);

      expect(pinged.estimatedArrivalAt).toEqual(existingEta);
    },
  );

  it('lets the driver run pickup → start → complete, syncing the order each step', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const done = await service.complete(driver, d.id, PROOF, AUTH);

    expect(done.status).toBe(DeliveryStatus.DELIVERED);
    expect(done.proof).toMatchObject({ recipientName: 'Budi', latitude: -6.9147 });
    expect(orders.calls.map((c) => c.status)).toEqual([
      'DRIVER_ASSIGNED',
      'PICKED_UP',
      'ON_DELIVERY',
      'DELIVERED',
      // Proof of delivery closes the order: without this the COMPLETED block in
      // order-service (loyalty, referral, stock consume) never runs.
      'COMPLETED',
    ]);
  });

  // H-8. The order used to be marched to DELIVERED and then COMPLETED before the proof
  // row was written. A proof write that failed left an order closed — stock consumed,
  // points awarded, courier paid — with no evidence anyone handed over anything.
  it('writes the proof before it closes the order, and closes nothing if the proof fails', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    jest.spyOn(repo, 'completeWithProof').mockRejectedValue(new Error('storage down'));
    const before = orders.calls.length;

    await expect(service.complete(driver, d.id, PROOF, AUTH)).rejects.toThrow('storage down');

    // No DELIVERED, no COMPLETED: the order stays where the courier left it.
    expect(orders.calls).toHaveLength(before);
  });

  // H-5. The transition check ran against a snapshot, so a courier double-tapping Selesai
  // — the thing a driver on a bad connection actually does — completed twice, wrote two
  // proof rows and pushed two earnings for one handover.
  it('pays for one handover when Selesai is tapped twice', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);

    const results = await Promise.allSettled([
      service.complete(driver, d.id, PROOF, AUTH),
      service.complete(driver, d.id, PROOF, AUTH),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(payout.events).toHaveLength(1);
  });

  it('still completes the delivery when the order cannot be closed', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    orders.throwOnStatus = 'COMPLETED';
    const done = await service.complete(driver, d.id, PROOF, AUTH);

    expect(done.status).toBe(DeliveryStatus.DELIVERED);
    expect(orders.calls.map((c) => c.status)).toContain('DELIVERED');
  });

  // The capture time itself is carried through by the repository (see prisma-repositories.spec)
  // and clamped by clampCapturedAt (see offline.spec); here we only pin the two service-level
  // rules — the assignment floor and the staleness refusal.
  it('floors offline proof at assignment so an early device clock cannot fake the SLA', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const beforeAssignment = new Date(d.assignedAt.getTime() - 30 * 60_000);
    const done = await service.complete(
      driver,
      d.id,
      { ...PROOF, capturedAt: beforeAssignment },
      AUTH,
    );
    expect(done.deliveredAt).toEqual(d.assignedAt);
  });

  it('refuses proof older than the offline window', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const ancient = new Date(Date.now() - 20 * 3_600_000);
    await expect(
      service.complete(driver, d.id, { ...PROOF, capturedAt: ancient }, AUTH),
    ).rejects.toBeInstanceOf(StaleCaptureError);
  });

  it('frees the driver for a new delivery once the first is delivered', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    await service.complete(driver, d.id, PROOF, AUTH);
    await expect(assign(driver)).resolves.toMatchObject({ status: DeliveryStatus.ASSIGNED });
  });

  it('forbids a driver acting on a delivery that is not theirs', async () => {
    const d = await assign();
    await expect(service.pickup(randomUUID(), d.id, AUTH)).rejects.toBeInstanceOf(
      NotAssignedDriverError,
    );
  });

  it('rejects an illegal transition (complete before pickup)', async () => {
    const d = await assign();
    await expect(service.complete(driver, d.id, PROOF, AUTH)).rejects.toBeInstanceOf(
      InvalidDeliveryTransitionError,
    );
  });

  it('fails closed and does not change delivery state when the order sync fails', async () => {
    const d = await assign();
    orders.throwOnAdvance = true;
    await expect(service.pickup(driver, d.id, AUTH)).rejects.toBeInstanceOf(OrderCoordinationError);
    expect((await service.getAny(d.id)).status).toBe(DeliveryStatus.ASSIGNED);
  });

  it('marks a delivery failed and cancels its order', async () => {
    const d = await assign();
    const failed = await service.fail(driver, d.id, 'address not found', AUTH);
    expect(failed.status).toBe(DeliveryStatus.FAILED);
    expect(failed.failureReason).toBe('address not found');
    // A FAILED delivery is terminal (reschedule is the retry path), so the order has to
    // close too — otherwise it is stranded mid-flight still holding its stock reservation.
    expect(orders.calls.map((c) => c.status)).toEqual(['DRIVER_ASSIGNED', 'CANCELLED']);
  });

  it('still records the failure when the order cannot be cancelled', async () => {
    const d = await assign();
    orders.throwOnStatus = 'CANCELLED';
    const failed = await service.fail(driver, d.id, 'address not found', AUTH);
    expect(failed.status).toBe(DeliveryStatus.FAILED);
  });

  it('gates no-show behind contact attempts + wait, then fails as no-show (5a)', async () => {
    const d = await assign();
    // Too early: no attempts yet.
    await expect(service.markNoShow(driver, d.id)).rejects.toBeInstanceOf(NoShowNotEligibleError);

    const first = await service.recordContactAttempt(driver, d.id, ContactMethod.CALL);
    expect(first.attempts).toBe(1);
    expect(first.canMarkNoShow).toBe(false); // needs 2 attempts
    const second = await service.recordContactAttempt(driver, d.id, ContactMethod.WHATSAPP);
    expect(second.attempts).toBe(2);
    expect(second.eligibleAt).not.toBeNull();

    // Still short of the wait window.
    const beforeWait = new Date(second.eligibleAt!.getTime() - 1000);
    await expect(service.markNoShow(driver, d.id, beforeWait)).rejects.toBeInstanceOf(
      NoShowNotEligibleError,
    );

    // Attempts met + wait elapsed → fails as no-show, and the order closes with it.
    const failed = await service.markNoShow(driver, d.id, second.eligibleAt!, AUTH);
    expect(failed.status).toBe(DeliveryStatus.FAILED);
    expect(failed.failureReason).toContain('no-show');
    expect(orders.calls.map((c) => c.status)).toEqual(['DRIVER_ASSIGNED', 'CANCELLED']);
  });

  it('reschedules a delivery and hands the order back to dispatch (3c)', async () => {
    const d = await assign();
    const when = new Date('2026-08-01T09:00:00.000Z');
    const out = await service.reschedule(driver, d.id, {
      rescheduledFor: when,
      slot: 'Pagi (09:00–12:00)',
      note: 'Pelanggan tidak di rumah.',
      authorization: AUTH,
    });
    expect(out.status).toBe(DeliveryStatus.RESCHEDULED);
    expect(out.rescheduledFor).toEqual(when);
    expect(out.rescheduleSlot).toBe('Pagi (09:00–12:00)');
    // RESCHEDULED frees the driver (non-active). The order is NOT advanced along the
    // fulfilment path — it is put back to PREPARING so dispatch can re-assign it. Leaving
    // it on the abandoned attempt's status is what made a rescheduled order undeliverable.
    expect(orders.calls.map((c) => c.status)).toEqual(['DRIVER_ASSIGNED', 'PREPARING']);
    expect(await repo.countActiveByDriver(driver)).toBe(0);
  });

  // H-30: the event a partner subscribes to. Published after the handover is recorded, so
  // a partner integration can never be the reason a delivery fails.
  it('publishes delivery.delivered once the handover is stored', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const done = await service.complete(driver, d.id, PROOF, AUTH);
    await Promise.resolve();

    expect(events.publish).toHaveBeenCalledTimes(1);
    const [event, payload] = events.publish.mock.calls[0]!;
    expect(event).toBe('delivery.delivered');
    expect(payload).toMatchObject({
      deliveryId: done.id,
      orderId: done.orderId,
      recipientName: PROOF.recipientName,
    });
  });

  it('completes normally when no partner fan-out is bound at all', async () => {
    const bare = makeStorageless();
    const d = await assign();
    await bare.pickup(driver, d.id, AUTH);
    await bare.start(driver, d.id, AUTH);

    await expect(bare.complete(driver, d.id, PROOF, AUTH)).resolves.toMatchObject({
      status: DeliveryStatus.DELIVERED,
    });
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("never reveals another driver's delivery (404)", async () => {
    const d = await assign();
    await expect(service.getForDriver(randomUUID(), d.id)).rejects.toBeInstanceOf(
      DeliveryNotFoundError,
    );
  });

  it("lists only the requesting driver's deliveries", async () => {
    await assign(driver);
    const mine = await service.listForDriver(driver, {});
    const others = await service.listForDriver(randomUUID(), {});
    expect(mine.total).toBe(1);
    expect(others.total).toBe(0);
  });

  it('purges proof-of-delivery records past the retention window (UU PDP)', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const done = await service.complete(driver, d.id, PROOF, AUTH);
    const capturedAt = done.proof!.capturedAt;

    // A cutoff at capture time leaves it alone — the row is not yet older than it.
    expect(await service.purgeProofsOlderThan(capturedAt)).toEqual({ purged: 0 });

    // A cutoff past the window → the proof (name/GPS/signature) is deleted. The cutoff
    // is supplied by admin-service's retention policy; this service never derives it.
    const later = new Date(capturedAt.getTime() + 366 * 86_400_000);
    expect(await service.purgeProofsOlderThan(later)).toEqual({ purged: 1 });
    expect((await service.getAny(d.id)).proof).toBeNull();

    // H-22: deleting the row alone left the photo — someone's doorstep, often with them in
    // frame — sitting in the bucket after the record that was supposed to be erased.
    expect(storage.remove).toHaveBeenCalledWith(storageKeyFromUrl(PROOF.photoUrl));
  });

  // A proof URL that predates the current storage layout has no `pod/` segment to key on.
  // The row still goes; the object is reported as left behind rather than silently skipped.
  it('reports a proof url it cannot turn into a storage key', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const done = await service.complete(
      driver,
      d.id,
      { ...PROOF, photoUrl: 'https://cdn/legacy.jpg', signatureUrl: null },
      AUTH,
    );

    expect(storageKeyFromUrl('https://cdn/legacy.jpg')).toBeNull();
    const later = new Date(done.proof!.capturedAt.getTime() + 366 * 86_400_000);
    await expect(service.purgeProofsOlderThan(later)).resolves.toEqual({ purged: 1 });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('leaves the objects alone, loudly, when no storage is bound', async () => {
    const bare = makeStorageless();
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const done = await service.complete(driver, d.id, PROOF, AUTH);

    const later = new Date(done.proof!.capturedAt.getTime() + 366 * 86_400_000);
    await expect(bare.purgeProofsOlderThan(later)).resolves.toEqual({ purged: 1 });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('finishes the sweep even when the bucket refuses one delete', async () => {
    const d = await assign();
    await service.pickup(driver, d.id, AUTH);
    await service.start(driver, d.id, AUTH);
    const done = await service.complete(driver, d.id, PROOF, AUTH);
    storage.remove.mockRejectedValueOnce(new Error('bucket unreachable'));

    const later = new Date(done.proof!.capturedAt.getTime() + 366 * 86_400_000);
    // The rows are already gone; one stubborn object must not abort erasure for everyone else.
    await expect(service.purgeProofsOlderThan(later)).resolves.toEqual({ purged: 1 });
  });
});
