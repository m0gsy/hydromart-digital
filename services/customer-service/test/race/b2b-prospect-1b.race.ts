import { randomUUID } from 'node:crypto';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { B2bProspectExportService } from '../../src/application/services/b2b-prospect-export.service';
import { B2bProspectPrismaRepository } from '../../src/infrastructure/prisma/b2b-prospect.prisma.repository';
import { buildTestConfig } from '../support/fakes';
import { describeRace, freshPrisma, race } from './db';

const DEPOT_A = '22222222-2222-4222-8222-222222222222';
const DEPOT_B = '33333333-3333-4333-8333-333333333333';
const kepala = { sub: randomUUID(), role: Role.KEPALA_DEPOT, phone: null, depotId: DEPOT_A, depotIds: [DEPOT_A] } as unknown as AuthenticatedUser;
const CUTOFF = new Date('2026-06-01T00:00:00.000Z');

/*
 * AREA-1b on a real Postgres: the retention purge against a concurrent check-in, the monthly owner
 * recompute against an HQ decision, and an export whose audit fails while many run at once.
 * A prospect is only ever whole: deleted with its visits, or alive with its new activity.
 */
describeRace('B2B prospect work, purge and export on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: B2bProspectPrismaRepository;
  const realFetch = global.fetch;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new B2bProspectPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());
  afterEach(() => {
    global.fetch = realFetch;
  });
  beforeEach(async () => {
    // EVERY table this file touches: visits first (they hang off prospects), then the rest.
    await prisma.b2bProspectVisit.deleteMany();
    await prisma.b2bProspect.deleteMany();
    await prisma.b2bDoNotContact.deleteMany();
    await prisma.b2bImportBatch.deleteMany();
  });

  const make = (over: Record<string, unknown> = {}) =>
    prisma.b2bProspect.create({
      data: {
        name: 'Kos Melati',
        nameKey: `kosmelati${randomUUID()}`,
        category: 'KOS',
        latitude: -6.5,
        longitude: 6,
        gridCell: '1:1',
        ownerDepotId: DEPOT_A,
        source: 'OSM',
        lastActivityAt: new Date(CUTOFF.getTime() - 1000),
        ...over,
      } as never,
    });
  const visitInput = { visitorId: randomUUID(), latitude: -6.5, longitude: 6, accuracyM: 5, distanceM: 0, outcome: 'NOT_THERE' as const, note: null };

  it('purge against a concurrent check-in on a row at the cutoff: whole, never half (20 rounds)', async () => {
    for (let round = 0; round < 20; round++) {
      const row = await make();
      const now = new Date();
      await race([() => repo.purge(CUTOFF), () => repo.recordVisit(row.id, 'NEW', 'VISITED', visitInput, now)]);
      const after = await prisma.b2bProspect.findUnique({ where: { id: row.id } });
      const visits = await prisma.b2bProspectVisit.count({ where: { prospectId: row.id } });
      if (after) {
        // survived: with its new activity and exactly its one visit
        expect(after.status).toBe('VISITED');
        expect(after.lastActivityAt.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1);
        expect(visits).toBe(1);
      } else {
        // deleted whole: the visit went with it, nothing orphaned
        expect(visits).toBe(0);
      }
      await prisma.b2bProspect.deleteMany({ where: { id: row.id } });
    }
  });

  it('a row exactly AT the cutoff survives the purge; one a millisecond older goes (real timestamp precision)', async () => {
    const at = await make({ lastActivityAt: CUTOFF });
    const older = await make({ lastActivityAt: new Date(CUTOFF.getTime() - 1) });
    const dnc = await prisma.b2bDoNotContact.create({ data: { kind: 'PHONE', keyHash: 'h', reason: 'LEGAL' } });
    expect(await repo.purge(CUTOFF)).toEqual({ deleted: 1, anonymised: 0 });
    expect(await prisma.b2bProspect.findUnique({ where: { id: at.id } })).not.toBeNull();
    expect(await prisma.b2bProspect.findUnique({ where: { id: older.id } })).toBeNull();
    expect(await prisma.b2bDoNotContact.findUnique({ where: { id: dnc.id } })).not.toBeNull();
  });

  it('anonymises a converted row once, keeps the counts fields, wipes its visit coordinates, and a second sweep is a no-op', async () => {
    const conv = await make({ status: 'CONVERTED', phoneE164: '+6281200000001', customerId: randomUUID(), convertedAt: new Date('2025-12-01T00:00:00Z'), kecamatanCode: '3173010' });
    await prisma.b2bProspectVisit.create({ data: { prospectId: conv.id, ...visitInput, latitude: -6.5, note: 'rahasia' } });
    expect(await repo.purge(CUTOFF)).toEqual({ deleted: 0, anonymised: 1 });
    expect(await repo.purge(CUTOFF)).toEqual({ deleted: 0, anonymised: 0 });
    const row = await prisma.b2bProspect.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row).toMatchObject({ status: 'CONVERTED', category: 'KOS', kecamatanCode: '3173010', ownerDepotId: DEPOT_A, nameKey: '', phoneE164: null, customerId: null, latitude: 0, longitude: 0 });
    expect(row.convertedAt).toEqual(new Date('2025-12-01T00:00:00Z'));
    expect(await prisma.b2bProspectVisit.findFirstOrThrow({ where: { prospectId: conv.id } })).toMatchObject({ latitude: 0, longitude: 0, note: null });
  });

  it('a do-not-contact row is purged on its own suppressedAt clock', async () => {
    const wiped = await make({ status: 'DO_NOT_CONTACT', nameKey: '', lastActivityAt: new Date('2025-01-01T00:00:00Z'), suppressedAt: new Date(CUTOFF.getTime() + 1000) });
    const old = await make({ status: 'DO_NOT_CONTACT', nameKey: '', lastActivityAt: new Date('2025-01-01T00:00:00Z'), suppressedAt: new Date(CUTOFF.getTime() - 1000) });
    expect(await repo.purge(CUTOFF)).toEqual({ deleted: 1, anonymised: 0 });
    expect(await prisma.b2bProspect.findUnique({ where: { id: wiped.id } })).not.toBeNull();
    expect(await prisma.b2bProspect.findUnique({ where: { id: old.id } })).toBeNull();
  });

  it('purges more than one batch of 1000 rows', async () => {
    await prisma.b2bProspect.createMany({
      data: Array.from({ length: 1050 }, (_, i) => ({
        name: `Usaha ${i}`, nameKey: `usaha${i}`, category: 'KOS' as const, latitude: -6.5, longitude: 6, gridCell: '1:1',
        ownerDepotId: DEPOT_A, source: 'OSM' as const, lastActivityAt: new Date(CUTOFF.getTime() - 1000),
      })),
    });
    expect(await repo.purge(CUTOFF)).toEqual({ deleted: 1050, anonymised: 0 });
    expect(await prisma.b2bProspect.count()).toBe(0);
  });

  it('the monthly recompute never overwrites an HQ decision made at the same moment (20 rounds)', async () => {
    for (let round = 0; round < 20; round++) {
      const row = await make({ lastActivityAt: new Date() });
      await race([
        () => repo.moveOwner(row.id, DEPOT_A, null),
        () => repo.update(row.id, { ownerDepotId: DEPOT_B, ownerSource: 'HQ' }),
      ]);
      expect(await prisma.b2bProspect.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ ownerDepotId: DEPOT_B, ownerSource: 'HQ' });
      await prisma.b2bProspect.deleteMany({ where: { id: row.id } });
    }
  });

  it('under load, an export whose audit fails returns no row to any of 25 parallel callers', async () => {
    for (let i = 0; i < 5; i++) await make({ lastActivityAt: new Date() });
    global.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    const svc = new B2bProspectExportService(repo, buildTestConfig({ AUTH_SERVICE_URL: 'http://auth.test', INTERNAL_SERVICE_KEY: 'internal-key-01' }));
    const res = await race(Array.from({ length: 25 }, () => () => svc.export(kepala, {})));
    expect(res.every((r) => r.status === 'rejected' && (r.reason as Error).message.includes('Ekspor dibatalkan'))).toBe(true);
  });
});
