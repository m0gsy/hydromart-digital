import { ProspectAggCell, ProspectAggKind, ProspectAggLevel, ProspectAggQuery } from '../../src/application/ports/b2b-prospect-aggregate.repository';
import { B2bProspectAggregatePrismaRepository } from '../../src/infrastructure/prisma/b2b-prospect-aggregate.prisma.repository';
import { describeRace, freshPrisma } from './db';

const DA = '11111111-1111-4111-8111-111111111111';
const DB = '22222222-2222-4222-8222-222222222222';
const VISITOR = '33333333-3333-4333-8333-333333333333';
const K1 = '3201010';
const K2 = '3201020';
const L1 = '3201010001';
const L2 = '3201020001';

/*
 * AREA-3: the aggregate SQL on a real Postgres. The unit specs only read the SQL text; this proves the
 * grouping, the opportunity bucket, the uuid[] depot filter, the percentile data age and, above all, that
 * the WIB month edges bind correctly against the naive timestamp(3) columns.
 */
describeRace('B2B prospect aggregates on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: B2bProspectAggregatePrismaRepository;

  const NOV = { from: new Date('2026-10-31T17:00:00Z'), to: new Date('2026-11-30T17:00:00Z') };
  const OCT = { from: new Date('2026-09-30T17:00:00Z'), to: new Date('2026-10-31T17:00:00Z') };
  const ask = (kind: ProspectAggKind, level: ProspectAggLevel, over: Partial<ProspectAggQuery> = {}) =>
    repo.aggregate({ kind, level, ...NOV, today: '2026-11-27', depotIds: null, opportunity: false, ...over });
  const at = (cells: ProspectAggCell[], key: string | null, parent: string | null = null) => cells.find((c) => c.key === key && c.parent === parent);

  let n = 0;
  const prospect = async (over: Record<string, unknown>) =>
    prisma.b2bProspect.create({
      data: {
        name: `Usaha ${++n}`,
        nameKey: `usaha ${n}`,
        category: 'KOS',
        latitude: -6.2,
        longitude: 106.8,
        gridCell: '1:1',
        kecamatanCode: K1,
        kelurahanCode: L1,
        ownerDepotId: DA,
        source: 'INTERNAL',
        lastActivityAt: new Date('2026-11-01T00:00:00Z'),
        createdAt: new Date('2026-11-01T00:00:00Z'),
        ...over,
      } as never,
    });
  const visit = (prospectId: string, visitedAt: string, outcome: 'NOT_THERE' | 'REFUSED') =>
    prisma.b2bProspectVisit.create({ data: { prospectId, visitorId: VISITOR, latitude: -6.2, longitude: 106.8, accuracyM: 5, distanceM: 10, outcome, visitedAt: new Date(visitedAt) } });

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new B2bProspectAggregatePrismaRepository(prisma as never);

    const p1 = await prospect({ status: 'NEW', phoneE164: '+628110000001', sourceDate: new Date('2026-11-17T00:00:00Z') }); // 10 days old on 27 Nov
    const p2 = await prospect({ status: 'CONTACTED', sourceDate: new Date('2026-11-07T00:00:00Z') }); // 20 days old
    const p3 = await prospect({ status: 'VISITED', category: 'SALON', phoneE164: '+628110000003', gridCell: '2:2', kecamatanCode: K2, kelurahanCode: L2, ownerDepotId: DB, sourceDate: new Date('2026-12-31T00:00:00Z') }); // a future date
    const p4 = await prospect({ status: 'NEW', category: 'LAUNDRY', gridCell: '3:3', kecamatanCode: null, kelurahanCode: null, ownerDepotId: null }); // no source date: created 1 Nov, 26 days
    await prospect({ status: 'CONVERTED', convertedAt: new Date('2026-10-31T17:30:00Z') }); // 1 Nov 00:30 WIB: November
    await prospect({ status: 'CONVERTED', category: 'SALON', convertedAt: new Date('2026-10-31T16:30:00Z') }); // 31 Oct 23:30 WIB: October
    await prospect({ status: 'CONVERTED', category: 'PABRIK_GUDANG', gridCell: '2:2', kecamatanCode: K2, kelurahanCode: L2, ownerDepotId: DB, convertedAt: new Date('2026-11-15T00:00:00Z') });
    await visit(p1.id, '2026-10-31T17:30:00Z', 'NOT_THERE'); // 1 Nov 00:30 WIB: November
    await visit(p1.id, '2026-11-10T03:00:00Z', 'REFUSED');
    await visit(p2.id, '2026-11-20T03:00:00Z', 'NOT_THERE');
    await visit(p3.id, '2026-10-31T16:30:00Z', 'NOT_THERE'); // 31 Oct 23:30 WIB: October
    await visit(p4.id, '2026-11-12T03:00:00Z', 'REFUSED');
  });
  afterAll(async () => drop?.());

  describe('stock (never CONVERTED)', () => {
    it('depot level: counts, categories, the 6 statuses, phones, percentile age (a future date is 0, no source date falls back to createdAt)', async () => {
      const cells = await ask('stock', 'depot', { opportunity: true });
      expect(cells).toHaveLength(3);
      expect(at(cells, DA)).toEqual({ key: DA, parent: null, total: 2, byCategory: { KOS: 2 }, byStatus: { NEW: 1, CONTACTED: 1 }, withPhone: 1, dataAgeDaysMedian: 15 });
      expect(at(cells, DB)).toEqual({ key: DB, parent: null, total: 1, byCategory: { SALON: 1 }, byStatus: { VISITED: 1 }, withPhone: 1, dataAgeDaysMedian: 0 });
      expect(at(cells, null)).toEqual({ key: null, parent: null, total: 1, byCategory: { LAUNDRY: 1 }, byStatus: { NEW: 1 }, withPhone: 0, dataAgeDaysMedian: 26 });
      expect(cells.flatMap((c) => Object.keys(c.byStatus ?? {}))).not.toContain('CONVERTED');
    });

    it('kecamatan, kelurahan (with its kecamatan) and grid levels', async () => {
      const kec = await ask('stock', 'kecamatan', { opportunity: true });
      expect([at(kec, K1)?.total, at(kec, K2)?.total, at(kec, null)?.total]).toEqual([2, 1, 1]);
      const kel = await ask('stock', 'kelurahan', { opportunity: true });
      expect([at(kel, L1, K1)?.total, at(kel, L2, K2)?.total, at(kel, null)?.total]).toEqual([2, 1, 1]);
      const grid = await ask('stock', 'grid', { opportunity: true });
      expect([at(grid, '1:1')?.total, at(grid, '2:2')?.total, at(grid, '3:3')?.total]).toEqual([2, 1, 1]);
    });

    it('the depotIds uuid[] filter keeps only those depots, and the opportunity bucket only when asked', async () => {
      const own = await ask('stock', 'depot', { depotIds: [DA] });
      expect(own.map((c) => c.key)).toEqual([DA]);
      const withBucket = await ask('stock', 'depot', { depotIds: [DA], opportunity: true });
      expect(withBucket.map((c) => c.key).sort()).toEqual([DA, null].sort());
      const everyDepot = await ask('stock', 'depot');
      expect(everyDepot.map((c) => c.key).sort()).toEqual([DA, DB].sort());
      expect(await ask('stock', 'depot', { depotIds: [] })).toEqual([]);
    });
  });

  describe('conversions', () => {
    it('counts a conversion at 1 Nov 00:30 WIB in November and not in October, at every level', async () => {
      const depot = await ask('conversions', 'depot');
      expect(at(depot, DA)).toEqual({ key: DA, parent: null, total: 1, byCategory: { KOS: 1 } });
      expect(at(depot, DB)).toEqual({ key: DB, parent: null, total: 1, byCategory: { PABRIK_GUDANG: 1 } });
      const kec = await ask('conversions', 'kecamatan');
      expect([at(kec, K1)?.total, at(kec, K2)?.total]).toEqual([1, 1]);
      const kel = await ask('conversions', 'kelurahan');
      expect([at(kel, L1, K1)?.total, at(kel, L2, K2)?.total]).toEqual([1, 1]);
      const grid = await ask('conversions', 'grid');
      expect([at(grid, '1:1')?.total, at(grid, '2:2')?.total]).toEqual([1, 1]);
      const oct = await ask('conversions', 'depot', OCT);
      expect(oct).toEqual([{ key: DA, parent: null, total: 1, byCategory: { SALON: 1 } }]);
    });
  });

  describe('visits', () => {
    it('counts a visit at 1 Nov 00:30 WIB in November and not in October, with distinct prospects and outcomes', async () => {
      const depot = await ask('visits', 'depot', { opportunity: true });
      expect(depot).toHaveLength(2); // DB's only visit is on 31 Oct 23:30 WIB
      expect(at(depot, DA)).toEqual({ key: DA, parent: null, total: 3, byOutcome: { NOT_THERE: 2, REFUSED: 1 }, prospectsVisited: 2 });
      expect(at(depot, null)).toEqual({ key: null, parent: null, total: 1, byOutcome: { REFUSED: 1 }, prospectsVisited: 1 });
      const kec = await ask('visits', 'kecamatan', { opportunity: true });
      expect([at(kec, K1)?.total, at(kec, null)?.total]).toEqual([3, 1]);
      const kel = await ask('visits', 'kelurahan', { opportunity: true });
      expect([at(kel, L1, K1)?.total, at(kel, null)?.total]).toEqual([3, 1]);
      const grid = await ask('visits', 'grid', { opportunity: true });
      expect([at(grid, '1:1')?.total, at(grid, '3:3')?.total]).toEqual([3, 1]);
      const oct = await ask('visits', 'depot', OCT);
      expect(oct).toEqual([{ key: DB, parent: null, total: 1, byOutcome: { NOT_THERE: 1 }, prospectsVisited: 1 }]);
    });

    it('the depotIds filter applies to visits too', async () => {
      const cells = await ask('visits', 'depot', { depotIds: [DB] });
      expect(cells).toEqual([]);
    });
  });
});
