import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegionAsset, RegionLookup } from '../../src/infrastructure/geo/region-lookup';
import { B2bProspectAggregatePrismaRepository } from '../../src/infrastructure/prisma/b2b-prospect-aggregate.prisma.repository';
import { ProspectAggQuery } from '../../src/application/ports/b2b-prospect-aggregate.repository';
import { ProspectAggregatesDto } from '../../src/modules/dto/regions.dto';
import { InternalRegionsController } from '../../src/modules/internal-regions.controller';

/** AREA-3: the grouped prospect numbers dashboard-service masks and publishes. */
const sq = (w: number, s: number, e: number, n: number) => [w, s, e, s, e, n, w, n, w, s];
const asset: RegionAsset = {
  adm3: [{ c: '320101', n: 'Kec Satu', b: [0, 0, 10, 10], g: [[sq(0, 0, 10, 10)]] }],
  adm4: [],
};
const DEPOT = '11111111-1111-4111-8111-111111111111';
const base: ProspectAggQuery = {
  kind: 'stock',
  level: 'kecamatan',
  from: new Date('2026-10-31T17:00:00Z'),
  to: new Date('2026-11-30T17:00:00Z'),
  today: '2026-11-27',
  depotIds: [DEPOT],
  opportunity: false,
};
/** The static text of the SQL one $queryRaw call was given. */
const sqlOf = (call: unknown[]): string => JSON.stringify(call).replace(/\\"/g, '"');

describe('B2bProspectAggregatePrismaRepository', () => {
  const run = async (q: ProspectAggQuery, ...results: unknown[][]) => {
    const raw = jest.fn();
    results.forEach((r) => raw.mockResolvedValueOnce(r));
    const cells = await new B2bProspectAggregatePrismaRepository({ $queryRaw: raw } as never).aggregate(q);
    return { cells, raw };
  };
  const FORBIDDEN = /latitude|longitude|"name"|nameKey|"address"|contactName|customerId|assignedToId|sourceId|visitorId|"note"/;

  it('stock: totals, categories, statuses, phones and the median age per cell', async () => {
    const { cells, raw } = await run(
      base,
      [
        { key: 'K1', parent: null, d1: 'KOS', d2: 'NEW', n: 3, phone: 2 },
        { key: 'K1', parent: null, d1: 'KOS', d2: 'VISITED', n: 1, phone: 1 },
        { key: 'K1', parent: null, d1: 'SALON', d2: 'NEW', n: 2, phone: 0 },
        { key: null, parent: null, d1: 'SALON', d2: 'NEW', n: 5, phone: 5 },
      ],
      [
        { key: 'K1', parent: null, v: 41.5 },
        { key: 'GONE', parent: null, v: 3 },
      ],
    );
    expect(cells).toEqual([
      { key: 'K1', parent: null, total: 6, byCategory: { KOS: 4, SALON: 2 }, byStatus: { NEW: 5, VISITED: 1 }, withPhone: 3, dataAgeDaysMedian: 42 },
      { key: null, parent: null, total: 5, byCategory: { SALON: 5 }, byStatus: { NEW: 5 }, withPhone: 5 },
    ]);
    expect(raw).toHaveBeenCalledTimes(2);
    const text = sqlOf(raw.mock.calls[0]);
    expect(text).toContain('"kecamatanCode"');
    expect(text).not.toMatch(FORBIDDEN);
    // never CONVERTED (converted counts exist only per month), and a future source date cannot make the age negative
    expect(text).toContain(`"status" <> 'CONVERTED'`);
    expect(sqlOf(raw.mock.calls[1])).toContain('GREATEST(0');
  });

  it('conversions: the converted month only, by stored columns, one query', async () => {
    const { cells, raw } = await run({ ...base, kind: 'conversions', level: 'grid', depotIds: null, opportunity: true }, [
      { key: '1:2', parent: null, d1: 'KOS', d2: null, n: 4, phone: 0 },
    ]);
    expect(cells).toEqual([{ key: '1:2', parent: null, total: 4, byCategory: { KOS: 4 } }]);
    expect(raw).toHaveBeenCalledTimes(1);
    const text = sqlOf(raw.mock.calls[0]);
    expect(text).toContain('"gridCell"');
    expect(text).toContain("'CONVERTED'");
    expect(text).toContain('"convertedAt"');
    expect(text).toContain('"ownerDepotId" IS NULL');
    expect(text).toContain('::timestamptz AT TIME ZONE');
    expect(text).not.toMatch(FORBIDDEN);
  });

  it('visits: accepted visits, distinct prospects and outcomes per kelurahan with its kecamatan', async () => {
    const { cells, raw } = await run(
      { ...base, kind: 'visits', level: 'kelurahan' },
      [
        { key: 'KEL', parent: 'KEC', d1: 'NOT_THERE', d2: null, n: 2, phone: 0 },
        { key: null, parent: 'KEC', d1: 'REFUSED', d2: null, n: 1, phone: 0 },
        { key: null, parent: 'KEC', d1: null, d2: null, n: 1, phone: 0 },
      ],
      [
        { key: 'KEL', parent: 'KEC', v: 2 },
        { key: null, parent: 'KEC', v: 2 },
      ],
    );
    expect(cells).toEqual([
      { key: 'KEL', parent: 'KEC', total: 2, byOutcome: { NOT_THERE: 2 }, prospectsVisited: 2 },
      { key: null, parent: 'KEC', total: 2, byOutcome: { REFUSED: 1 }, prospectsVisited: 2 },
    ]);
    const text = sqlOf(raw.mock.calls[0]);
    expect(text).toContain('"visitedAt"');
    expect(text).not.toMatch(FORBIDDEN);
  });

  it('depot level groups by the owner depot', async () => {
    const { cells, raw } = await run({ ...base, level: 'depot', opportunity: true }, [{ key: DEPOT, parent: null, d1: 'KOS', d2: 'NEW', n: 1, phone: 1 }], []);
    expect(cells[0].key).toBe(DEPOT);
    expect(sqlOf(raw.mock.calls[0])).toContain('"ownerDepotId"::text');
  });
});

describe('InternalRegionsController.prospectAggregates', () => {
  const agg = {
    aggregate: jest.fn().mockResolvedValue([
      { key: '320101', parent: null, total: 4 },
      { key: '999', parent: null, total: 3 },
      { key: null, parent: null, total: 1 },
    ]),
  };
  const c = new InternalRegionsController(new RegionLookup(asset), {} as never, agg as never);
  const dto = { kind: 'conversions', level: 'kecamatan', month: '2026-11', depotIds: null, opportunity: true } as ProspectAggregatesDto;

  it('turns the month into the WIB instants, names the regions and passes the scope through', async () => {
    const r = await c.prospectAggregates(dto);
    const q = agg.aggregate.mock.calls[0][0];
    expect(q.from.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(q.to.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(q.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q).toMatchObject({ kind: 'conversions', level: 'kecamatan', depotIds: null, opportunity: true });
    expect(r.cells.map((x) => x.name)).toEqual(['Kec Satu', null, null]);
  });

  it('above 5000 cells it says tooMany and sends none', async () => {
    agg.aggregate.mockResolvedValueOnce(Array.from({ length: 5001 }, (_, i) => ({ key: `${i}:0`, parent: null, total: 1 })));
    await expect(c.prospectAggregates({ ...dto, level: 'grid' })).resolves.toEqual({ cells: [], tooMany: true });
    agg.aggregate.mockResolvedValueOnce(Array.from({ length: 5000 }, (_, i) => ({ key: `${i}:0`, parent: null, total: 1 })));
    expect((await c.prospectAggregates({ ...dto, level: 'grid' })).cells).toHaveLength(5000);
  });

  it('names nothing at grid level', async () => {
    const r = await c.prospectAggregates({ ...dto, level: 'grid' });
    expect(r.cells.every((x) => x.name === null)).toBe(true);
  });

  it('never carries a personal field in the reply', async () => {
    const r = await c.prospectAggregates(dto);
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (keys.add(k), walk(x)));
    };
    walk(r);
    for (const bad of ['phone', 'phoneE164', 'address', 'latitude', 'longitude', 'prospectId', 'customerId', 'assignedToId', 'visitorId', 'sourceId', 'contactName', 'nameKey', 'note']) {
      expect(keys.has(bad)).toBe(false);
    }
  });

  it('is internal-key only', () => {
    const guards = Reflect.getMetadata('__guards__', InternalRegionsController) as { name: string }[];
    expect(guards.map((g) => g.name)).toContain('InternalAuthGuard');
  });

  it('bounds its input', async () => {
    const n = async (body: object) => (await validate(plainToInstance(ProspectAggregatesDto, { ...dto, ...body }))).length;
    expect(await n({})).toBe(0);
    expect(await n({ depotIds: [DEPOT] })).toBe(0);
    expect(await n({ depotIds: ['nope'] })).toBeGreaterThan(0);
    expect(await n({ depotIds: Array.from({ length: 101 }, () => DEPOT) })).toBeGreaterThan(0);
    expect(await n({ kind: 'rows' })).toBeGreaterThan(0);
    expect(await n({ level: 'address' })).toBeGreaterThan(0);
    expect(await n({ month: '2026-13' })).toBeGreaterThan(0);
    expect(await n({ opportunity: 'yes' })).toBeGreaterThan(0);
  });
});
