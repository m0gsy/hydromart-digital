import { randomUUID } from 'node:crypto';

import { AuthenticatedUser } from '@hydromart/platform';

import { IncidentService } from '../../src/application/services/incident.service';
import { IncidentCategory, IncidentSeverity } from '../../src/domain/incident';
import { DeliveryNotFoundError, NotAssignedDriverError } from '../../src/domain/errors';
import { FakeOpsNotifier, InMemoryDeliveryRepository, InMemoryIncidentRepository } from '../support/fakes';

describe('IncidentService', () => {
  let repo: InMemoryIncidentRepository;
  let ops: FakeOpsNotifier;
  let service: IncidentService;
  let deliveries: InMemoryDeliveryRepository;
  const driver = randomUUID();

  beforeEach(() => {
    repo = new InMemoryIncidentRepository();
    ops = new FakeOpsNotifier();
    deliveries = new InMemoryDeliveryRepository();
    service = new IncidentService(repo, ops, deliveries);
  });

  // DLV-15: a courier could attach an incident to ANY delivery id, and name any depot, putting
  // the report on another depot's review list. A delivery must be the reporter's own, and its
  // depot is the delivery's, not the client's.
  describe('naming a delivery (DLV-15)', () => {
    const seed = (driverId: string, depotId: string | null) =>
      deliveries.create({
        orderId: randomUUID(),
        orderNumber: 'HM-1',
        driverId,
        depotId,
        destinationAddress: 'Jl. A',
        destinationLat: null,
        destinationLng: null,
        recipientPhone: null,
      } as never);

    it('takes the depot from the courier own delivery, ignoring the one the client sent', async () => {
      const mine = await seed(driver, 'depot-real');
      const out = await service.report(driver, {
        deliveryId: mine.id,
        depotId: 'depot-claimed',
        category: IncidentCategory.ACCIDENT,
        severity: IncidentSeverity.LOW,
        description: 'Ban bocor',
      });
      expect(out.deliveryId).toBe(mine.id);
      expect(out.depotId).toBe('depot-real');
    });

    it('refuses another courier delivery, and an unknown one, and stores nothing', async () => {
      const theirs = await seed(randomUUID(), 'depot-x');
      const base = { category: IncidentCategory.ACCIDENT, severity: IncidentSeverity.LOW, description: 'Ban bocor' };
      await expect(service.report(driver, { ...base, deliveryId: theirs.id })).rejects.toBeInstanceOf(NotAssignedDriverError);
      await expect(service.report(driver, { ...base, deliveryId: randomUUID() })).rejects.toBeInstanceOf(DeliveryNotFoundError);
      expect(repo.rows).toHaveLength(0);
    });

    it('keeps the delivery depotless when the delivery has none, falling back to the one given', async () => {
      const mine = await seed(driver, null);
      const out = await service.report(driver, {
        deliveryId: mine.id,
        depotId: 'depot-given',
        category: IncidentCategory.ACCIDENT,
        severity: IncidentSeverity.LOW,
        description: 'Ban bocor',
      });
      expect(out.depotId).toBe('depot-given');
    });
  });

  const report = (severity: IncidentSeverity) =>
    service.report(driver, {
      category: IncidentCategory.ACCIDENT,
      severity,
      description: 'Ban bocor',
    });

  it('stores the incident and alerts ops for HIGH severity', async () => {
    const incident = await report(IncidentSeverity.HIGH);
    expect(incident).toMatchObject({ severity: IncidentSeverity.HIGH, driverId: driver });
    expect(repo.rows).toHaveLength(1);
    expect(ops.alerts).toHaveLength(1);
    expect(ops.alerts[0]).toMatchObject({
      severity: IncidentSeverity.HIGH,
      category: IncidentCategory.ACCIDENT,
    });
  });

  it('does not alert ops for LOW/MEDIUM severity', async () => {
    await report(IncidentSeverity.LOW);
    await report(IncidentSeverity.MEDIUM);
    expect(repo.rows).toHaveLength(2);
    expect(ops.alerts).toHaveLength(0);
  });

  it('lists a driver’s incidents newest first', async () => {
    await report(IncidentSeverity.LOW);
    await report(IncidentSeverity.HIGH);
    const list = await service.listForDriver(driver);
    expect(list).toHaveLength(2);
    expect(list[0].createdAt.getTime()).toBeGreaterThanOrEqual(list[1].createdAt.getTime());
  });

  /*
   * CA-4-48. `escalatesToOps` interrupts an operator for HIGH only and calls LOW and MEDIUM
   * "logged for later review". Nothing could review them: the only other read was a
   * courier's own history, so the person who wrote the report was the only person who could
   * read it.
   */
  describe('CA-4-48 the depot can read what its couriers reported', () => {
    const DEPOT_A = randomUUID();
    const DEPOT_B = randomUUID();
    const manager = (depotId: string): AuthenticatedUser => ({
      sub: randomUUID(),
      role: 'MANAGER' as never,
      phone: null,
      depotId,
    });
    const hq: AuthenticatedUser = {
      sub: randomUUID(),
      role: 'SUPER_ADMIN' as never,
      phone: null,
      depotId: null,
    };

    const reportAt = (depotId: string | undefined, severity: IncidentSeverity) =>
      service.report(randomUUID(), {
        category: IncidentCategory.VEHICLE_BREAKDOWN,
        severity,
        description: 'Rantai putus',
        depotId,
      });

    it('returns the low and medium ones ops was never interrupted for', async () => {
      await reportAt(DEPOT_A, IncidentSeverity.LOW);
      await reportAt(DEPOT_A, IncidentSeverity.MEDIUM);
      await reportAt(DEPOT_A, IncidentSeverity.HIGH);

      const rows = await service.listForDepot(manager(DEPOT_A));

      expect(rows.map((r) => r.severity).sort()).toEqual(['HIGH', 'LOW', 'MEDIUM']);
      // Only the HIGH one ever reached an operator.
      expect(ops.alerts).toHaveLength(1);
    });

    it('never shows one depot another depot’s incidents', async () => {
      await reportAt(DEPOT_A, IncidentSeverity.LOW);
      await reportAt(DEPOT_B, IncidentSeverity.LOW);

      const rows = await service.listForDepot(manager(DEPOT_A));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.depotId).toBe(DEPOT_A);
    });

    it('refuses a depot-locked reader asking about somebody else’s depot', async () => {
      await expect(service.listForDepot(manager(DEPOT_A), DEPOT_B)).rejects.toThrow();
    });

    it('gives a network-wide reader every depot, and lets them name one', async () => {
      await reportAt(DEPOT_A, IncidentSeverity.LOW);
      await reportAt(DEPOT_B, IncidentSeverity.MEDIUM);

      expect(await service.listForDepot(hq)).toHaveLength(2);
      expect(await service.listForDepot(hq, DEPOT_B)).toHaveLength(1);
    });

    it('leaves a depot-less row out of every depot queue rather than guessing', async () => {
      await reportAt(undefined, IncidentSeverity.LOW);

      expect(await service.listForDepot(manager(DEPOT_A))).toHaveLength(0);
      // It is still readable network-wide, so it is not lost.
      expect(await service.listForDepot(hq)).toHaveLength(1);
    });
  });

  /*
   * CA-4-49, the half the first pass left behind. The bucket was made private and the PoD
   * photo and signature moved to expiring links; an incident's photo goes to the SAME
   * bucket through the same upload endpoint and kept being handed out as the stored key
   * string — which resolves to nothing now, and to everything forever on any deployment
   * whose bucket is still public.
   */
  describe('CA-4-49 an incident photo is an expiring link, never the stored key', () => {
    const storage = {
      signedUrl: jest.fn(async (key: string, ttl: number) => `https://signed/${key}?ttl=${ttl}`),
    };

    beforeEach(() => {
      storage.signedUrl.mockClear();
      service = new IncidentService(repo, ops, deliveries, storage as never);
    });

    it('signs the key derived from the stored URL, for fifteen minutes', async () => {
      const link = await service.signedPhotoUrl('https://cdn.example.com/pod/abc.jpg');
      expect(link).toBe('https://signed/pod/abc.jpg?ttl=900');
      expect(storage.signedUrl).toHaveBeenCalledWith('pod/abc.jpg', 900);
    });

    it('answers null rather than a broken frame when there is nothing to sign', async () => {
      expect(await service.signedPhotoUrl(null)).toBeNull();
      // A hand-typed value from before the upload path existed carries no key.
      expect(await service.signedPhotoUrl('https://example.com/some/photo.jpg')).toBeNull();
      expect(storage.signedUrl).not.toHaveBeenCalled();
    });

    it('answers null when no storage is bound at all', async () => {
      const noStorage = new IncidentService(repo, ops, deliveries);
      expect(await noStorage.signedPhotoUrl('https://cdn.example.com/pod/abc.jpg')).toBeNull();
    });
  });
});
