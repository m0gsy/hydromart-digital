import { randomUUID } from 'node:crypto';

import { DeliveryService } from '../../src/application/services/delivery.service';
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
} from '../../src/domain/errors';
import { DeliveryStatus } from '../../src/domain/delivery-status';
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
  photoUrl: 'https://cdn/x.jpg',
  signatureUrl: 'https://cdn/sig.png',
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
  let shifts: ShiftService;
  let service: DeliveryService;
  const driver = randomUUID();
  const staff = randomUUID();

  beforeEach(async () => {
    repo = new InMemoryDeliveryRepository();
    orders = new FakeOrderCoordination();
    const config = buildTestConfig();
    shifts = new ShiftService(new InMemoryShiftRepository(), new FakeDepotLocation(), config);
    service = new DeliveryService(repo, orders, new FakeCourierPayout(), shifts, config);
    // Assignment now requires an open ONLINE shift, so every driver clocks in first.
    await shifts.checkIn(driver, DEPOT_ID, AT_DEPOT.lat, AT_DEPOT.lng);
  });

  const assign = (driverId = driver, orderId = randomUUID()) =>
    service.assign(
      staff,
      { orderId, orderNumber: 'HM-1', driverId, destinationAddress: 'Jl. Merdeka 10' },
      AUTH,
    );

  it('assigns a driver and advances the order to DRIVER_ASSIGNED', async () => {
    const d = await assign();
    expect(d.status).toBe(DeliveryStatus.ASSIGNED);
    expect(orders.calls).toEqual([{ orderId: d.orderId, status: 'DRIVER_ASSIGNED' }]);
  });

  it('rejects a second delivery for the same order', async () => {
    const orderId = randomUUID();
    await assign(driver, orderId);
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
    ]);
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

  it('marks a delivery failed without touching the order', async () => {
    const d = await assign();
    const failed = await service.fail(driver, d.id, 'address not found');
    expect(failed.status).toBe(DeliveryStatus.FAILED);
    expect(failed.failureReason).toBe('address not found');
    // Only the assignment sync happened; failure does not advance the order.
    expect(orders.calls).toHaveLength(1);
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

    // Attempts met + wait elapsed → fails as no-show, order untouched.
    const failed = await service.markNoShow(driver, d.id, second.eligibleAt!);
    expect(failed.status).toBe(DeliveryStatus.FAILED);
    expect(failed.failureReason).toContain('no-show');
    expect(orders.calls).toHaveLength(1);
  });

  it('reschedules a delivery without advancing the order (3c)', async () => {
    const d = await assign();
    const when = new Date('2026-08-01T09:00:00.000Z');
    const out = await service.reschedule(driver, d.id, {
      rescheduledFor: when,
      slot: 'Pagi (09:00–12:00)',
      note: 'Pelanggan tidak di rumah.',
    });
    expect(out.status).toBe(DeliveryStatus.RESCHEDULED);
    expect(out.rescheduledFor).toEqual(when);
    expect(out.rescheduleSlot).toBe('Pagi (09:00–12:00)');
    // RESCHEDULED frees the driver (non-active) and never advanced the order.
    expect(orders.calls).toHaveLength(1);
    expect(await repo.countActiveByDriver(driver)).toBe(0);
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

    // Within the window (default 365d) → nothing purged.
    expect(await service.purgeExpiredProofs(capturedAt)).toEqual({ purged: 0 });

    // Past the window → the proof (name/GPS/signature) is deleted.
    const later = new Date(capturedAt.getTime() + 366 * 86_400_000);
    expect(await service.purgeExpiredProofs(later)).toEqual({ purged: 1 });
    expect((await service.getAny(d.id)).proof).toBeNull();
  });
});
