import { randomUUID } from 'node:crypto';

import { ShiftService } from '../../src/application/services/shift.service';
import {
  DepotLookupError,
  InvalidShiftTransitionError,
  NotAtDepotError,
  ShiftAlreadyOpenError,
  ShiftNotFoundError,
} from '../../src/domain/errors';
import { ShiftStatus } from '../../src/domain/shift';
import { FakeDepotLocation, InMemoryShiftRepository, buildTestConfig } from '../support/fakes';

const DEPOT_ID = '00000000-0000-4000-8000-000000000001';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };
const FAR_AWAY = { lat: -6.2088, lng: 106.8456 };

describe('ShiftService', () => {
  let repo: InMemoryShiftRepository;
  let depots: FakeDepotLocation;
  let service: ShiftService;
  const driver = randomUUID();

  beforeEach(() => {
    repo = new InMemoryShiftRepository();
    depots = new FakeDepotLocation();
    service = new ShiftService(repo, depots, buildTestConfig());
  });

  const checkIn = (driverId = driver) =>
    service.checkIn(driverId, DEPOT_ID, AT_DEPOT.lat, AT_DEPOT.lng);

  describe('checkIn', () => {
    it('opens an ONLINE shift when the courier is at the depot', async () => {
      const shift = await checkIn();
      expect(shift).toMatchObject({
        driverId: driver,
        depotId: DEPOT_ID,
        status: ShiftStatus.ONLINE,
        acceptsAssignments: true,
        breakSecondsUsed: 0,
      });
      expect(shift.breakSecondsRemaining).toBe(1800);
    });

    it('freezes the shift end 8 hours after check-in', async () => {
      const shift = await checkIn();
      expect(shift.expectedEndAt.getTime() - shift.checkInAt.getTime()).toBe(8 * 3_600_000);
    });

    it('rejects a check-in away from the depot', async () => {
      await expect(
        service.checkIn(driver, DEPOT_ID, FAR_AWAY.lat, FAR_AWAY.lng),
      ).rejects.toBeInstanceOf(NotAtDepotError);
    });

    it('rejects a second check-in while a shift is open', async () => {
      await checkIn();
      await expect(checkIn()).rejects.toBeInstanceOf(ShiftAlreadyOpenError);
    });

    it('lets a courier check in again after checking out', async () => {
      const first = await checkIn();
      await service.checkOut(driver, first.id, AT_DEPOT.lat, AT_DEPOT.lng);
      await expect(checkIn()).resolves.toMatchObject({ status: ShiftStatus.ONLINE });
    });

    it('fails closed when the depot cannot be read', async () => {
      depots.throwOnFind = true;
      await expect(checkIn()).rejects.toBeInstanceOf(DepotLookupError);
    });

    it('fails closed when the depot has no coordinates', async () => {
      depots.depot = null;
      await expect(checkIn()).rejects.toBeInstanceOf(DepotLookupError);
    });
  });

  describe('setStatus', () => {
    it('stops handing out work on BREAK and resumes on ONLINE', async () => {
      const shift = await checkIn();
      const paused = await service.setStatus(driver, shift.id, ShiftStatus.BREAK);
      expect(paused.acceptsAssignments).toBe(false);
      expect(await service.isAvailable(driver)).toBe(false);

      const resumed = await service.setStatus(driver, shift.id, ShiftStatus.ONLINE);
      expect(resumed.acceptsAssignments).toBe(true);
      expect(await service.isAvailable(driver)).toBe(true);
    });

    it('stops handing out work on OFFLINE without ending the shift', async () => {
      const shift = await checkIn();
      const off = await service.setStatus(driver, shift.id, ShiftStatus.OFFLINE);
      expect(off.acceptsAssignments).toBe(false);
      expect(off.checkOutAt).toBeNull();
      await expect(service.current(driver)).resolves.not.toBeNull();
    });

    it('banks the elapsed break time when leaving BREAK', async () => {
      const shift = await checkIn();
      await service.setStatus(driver, shift.id, ShiftStatus.BREAK);
      // Rewind the marker 10 minutes so the bank has something real to count.
      repo.rows[0].breakStartedAt = new Date(Date.now() - 600_000);

      const resumed = await service.setStatus(driver, shift.id, ShiftStatus.ONLINE);
      expect(resumed.breakSecondsUsed).toBeGreaterThanOrEqual(600);
      expect(resumed.breakStartedAt).toBeNull();
      expect(resumed.breakSecondsRemaining).toBeLessThanOrEqual(1200);
    });

    it('lets a courier resume past quota rather than stranding them on break', async () => {
      const shift = await checkIn();
      await service.setStatus(driver, shift.id, ShiftStatus.BREAK);
      repo.rows[0].breakStartedAt = new Date(Date.now() - 3_600_000); // an hour, quota is 30 min

      const resumed = await service.setStatus(driver, shift.id, ShiftStatus.ONLINE);
      expect(resumed.status).toBe(ShiftStatus.ONLINE);
      expect(resumed.breakSecondsRemaining).toBe(0);
      expect(resumed.breakSecondsUsed).toBeGreaterThan(1800);
    });

    it('refuses to end a shift through setStatus (check-out owns that)', async () => {
      const shift = await checkIn();
      await expect(service.setStatus(driver, shift.id, ShiftStatus.ENDED)).rejects.toBeInstanceOf(
        InvalidShiftTransitionError,
      );
    });

    it("hides another courier's shift rather than forbidding it", async () => {
      const shift = await checkIn();
      await expect(
        service.setStatus(randomUUID(), shift.id, ShiftStatus.BREAK),
      ).rejects.toBeInstanceOf(ShiftNotFoundError);
    });
  });

  describe('checkOut', () => {
    it('closes the shift and records where', async () => {
      const shift = await checkIn();
      const ended = await service.checkOut(driver, shift.id, AT_DEPOT.lat, AT_DEPOT.lng);
      expect(ended).toMatchObject({
        status: ShiftStatus.ENDED,
        checkOutLat: AT_DEPOT.lat,
        checkOutLng: AT_DEPOT.lng,
        acceptsAssignments: false,
      });
      expect(ended.checkOutAt).toBeInstanceOf(Date);
      await expect(service.current(driver)).resolves.toBeNull();
    });

    it('banks a running break so the shift total stays honest', async () => {
      const shift = await checkIn();
      await service.setStatus(driver, shift.id, ShiftStatus.BREAK);
      repo.rows[0].breakStartedAt = new Date(Date.now() - 300_000);

      const ended = await service.checkOut(driver, shift.id, AT_DEPOT.lat, AT_DEPOT.lng);
      expect(ended.breakSecondsUsed).toBeGreaterThanOrEqual(300);
      expect(ended.breakStartedAt).toBeNull();
    });

    it('refuses to close an already-closed shift', async () => {
      const shift = await checkIn();
      await service.checkOut(driver, shift.id, AT_DEPOT.lat, AT_DEPOT.lng);
      await expect(
        service.checkOut(driver, shift.id, AT_DEPOT.lat, AT_DEPOT.lng),
      ).rejects.toBeInstanceOf(ShiftNotFoundError);
    });
  });

  describe('reads', () => {
    it('returns null when the courier has never checked in', async () => {
      await expect(service.current(driver)).resolves.toBeNull();
      expect(await service.isAvailable(driver)).toBe(false);
    });

    it('lists the courier history newest first', async () => {
      const first = await checkIn();
      await service.checkOut(driver, first.id, AT_DEPOT.lat, AT_DEPOT.lng);
      // Both check-ins use the real clock and could land in the same millisecond,
      // which would make the ordering assertion a coin flip. Pin the older one.
      repo.rows[0].checkInAt = new Date(Date.now() - 86_400_000);
      const second = await checkIn();

      const history = await service.history(driver);
      expect(history.map((s) => s.id)).toEqual([second.id, first.id]);
    });

    it('scopes the dispatch view to one depot', async () => {
      await checkIn();
      depots.depot = { id: 'other', name: 'Depot Dago', lat: AT_DEPOT.lat, lng: AT_DEPOT.lng };
      const otherDepotId = '00000000-0000-4000-8000-000000000002';
      await service.checkIn(randomUUID(), otherDepotId, AT_DEPOT.lat, AT_DEPOT.lng);

      const atDepot = await service.search({ depotId: DEPOT_ID });
      expect(atDepot).toHaveLength(1);
      expect(atDepot[0].driverId).toBe(driver);
    });
  });
});
