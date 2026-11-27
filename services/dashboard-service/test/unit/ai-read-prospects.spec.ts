import 'reflect-metadata';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AuthenticatedUser, gridCell1km } from '@hydromart/platform';

import { PROSPECT_METRIC_IDS, PROSPECT_METRICS, ProspectMetricsService } from '../../src/application/ai-read/prospect-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { ProspectAggregate } from '../../src/application/ports/ai-prospect-sources.port';
import { AiProspectSourcesHttpAdapter } from '../../src/infrastructure/http/ai-prospect-sources.http.adapter';
import { AiReadProspectController } from '../../src/modules/ai-read-prospect.controller';
import { ProspectQueryDto } from '../../src/modules/dto/ai-read-prospect.dto';

/*
 * AREA-3: the masked B2B prospect aggregates. The source is stubbed; under test are the scope rules (own
 * depots, the opportunity bucket for network readers only), the month rules, the masking of cells and of
 * every breakdown, and that no name, phone, address, coordinate or id of a person or prospect leaves.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLOSED = new Date('2026-12-01T03:00:00.000Z'); // 1 Dec 10:00 WIB: November is closed
const LAST_MINUTE = new Date('2026-11-30T16:59:00.000Z'); // 23:59 WIB on 30 Nov: still November
const RUNNING = new Date('2026-11-25T03:00:00.000Z');
const Q = { month: '2026-11' };
const ADMIN = { sub: 'u1', role: 'SUPER_ADMIN', depotId: null } as unknown as AuthenticatedUser;
const FINANCE = { sub: 'u2', role: 'FINANCE', depotId: null } as unknown as AuthenticatedUser;
const KEPALA = { sub: 'u3', role: 'KEPALA_DEPOT', depotId: D1, depotIds: [D1] } as unknown as AuthenticatedUser;
const MACHINE = { sub: 'm1', role: 'SUPER_ADMIN', depotId: null, via: 'machine' } as unknown as AuthenticatedUser;

const DEPOTS = [
  { id: D1, code: 'D1', name: 'Depot Satu', active: true, ownershipType: 'OWN' },
  { id: D2, code: 'D2', name: 'Depot Dua', active: true, ownershipType: 'OWN' },
];
const ONE: ReadScope = {
  spans: [{ depotId: D1, legalEntityId: PT_A, from: '2026-11-01', to: '2026-11-30' }],
  echo: { depotIds: [D1], legalEntityIds: [PT_A] },
};
const NONE: ReadScope = { spans: [], echo: { depotIds: [], legalEntityIds: [] } };
const ALL: ReadScope = { spans: [...ONE.spans, { depotId: D2, legalEntityId: PT_A, from: '2026-11-01', to: '2026-11-30' }], echo: { depotIds: [D1, D2], legalEntityIds: [PT_A] }, network: DEPOTS };

const KEC = (n: number) => `32010${String(n).padStart(2, '0')}`; // 7 digits
const KEL = (kec: number, n: number) => `${KEC(kec)}${String(n).padStart(3, '0')}`;
const row = (key: string | null, total: number, more: Partial<ProspectAggregate> = {}): ProspectAggregate => ({ key, parent: null, name: key ? `Wilayah ${key}` : null, total, ...more });

function make(opts: { rows?: ProspectAggregate[] | null; scope?: ReadScope; grants?: { all: boolean } | null; allDepots?: unknown } = {}) {
  const sources = { prospectAggregates: jest.fn(async (..._a: unknown[]) => (opts.rows === undefined ? [] : opts.rows)) };
  const scopes = { resolve: jest.fn(async () => opts.scope ?? ONE) } as unknown as ReadScopeService;
  const grants = { aiGrants: jest.fn(async () => (opts.grants === undefined ? { all: true, legalEntityIds: [] } : opts.grants)) };
  const depots = { allDepots: jest.fn(async () => (opts.allDepots === undefined ? DEPOTS : opts.allDepots)) };
  return { sources, grants, depots, service: new ProspectMetricsService(scopes, sources as never, grants as never, depots as never) };
}
type Cells = { id: string | null; label: string | null; total: number | null; flag?: string; [k: string]: unknown }[];
const cellsOf = (a: { value: unknown }) => (a.value as { cells: Cells }).cells;

describe('scope', () => {
  it('a depot caller counts only its own depots and never gets the opportunity bucket', async () => {
    const { service, sources } = make({ rows: [row(KEC(1), 5)] });
    const a = await service.answer('B-02', KEPALA, Q, CLOSED);
    expect(a.status).toBe('ok');
    expect(sources.prospectAggregates).toHaveBeenCalledWith({ kind: 'conversions', level: 'kecamatan', month: '2026-11', depotIds: [D1], opportunity: false }, expect.any(Number));
  });

  it('a role that reads every depot and entity asks for every depot plus the opportunity bucket', async () => {
    const { service, sources } = make({ rows: [row(KEC(1), 5)], scope: ALL });
    await service.answer('B-03', ADMIN, Q, CLOSED);
    expect(sources.prospectAggregates).toHaveBeenCalledWith({ kind: 'visits', level: 'kecamatan', month: '2026-11', depotIds: null, opportunity: true }, expect.any(Number));
  });

  it('the machine account reads the network too', async () => {
    const { service, sources } = make({ rows: [], scope: ALL });
    await service.answer('B-02', MACHINE, Q, CLOSED);
    expect(sources.prospectAggregates.mock.calls[0]).toEqual([expect.objectContaining({ depotIds: null, opportunity: true }), expect.any(Number)]);
  });

  it('a network role that is not granted every entity is scoped to the depots it may read, without the bucket', async () => {
    const { service, sources } = make({ rows: [], scope: ALL, grants: { all: false } });
    await service.answer('B-02', FINANCE, Q, CLOSED);
    expect(sources.prospectAggregates.mock.calls[0]).toEqual([expect.objectContaining({ depotIds: [D1, D2], opportunity: false }), expect.any(Number)]);
    const missing = make({ rows: [], scope: ALL, grants: null });
    await missing.service.answer('B-02', FINANCE, Q, CLOSED);
    expect(missing.sources.prospectAggregates.mock.calls[0][0]).toMatchObject({ opportunity: false });
  });

  it('a depot role with no depot of its own is not a network reader', async () => {
    const orphan = { sub: 'u9', role: 'KEPALA_DEPOT', depotId: null } as unknown as AuthenticatedUser;
    const { service, sources } = make({ rows: [], scope: ALL });
    await service.answer('B-02', orphan, Q, CLOSED);
    expect(sources.prospectAggregates.mock.calls[0]).toEqual([expect.objectContaining({ opportunity: false }), expect.any(Number)]);
  });

  it('answers the running month of the real clock when no clock is passed', async () => {
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    expect((await make({ rows: [row(KEC(1), 5)] }).service.answer('B-01', KEPALA, { month })).status).toBe('ok');
  });

  it('a caller with no readable depot gets belum_ada, and the source is not asked', async () => {
    const { service, sources } = make({ scope: NONE });
    const a = await service.answer('B-02', KEPALA, Q, CLOSED);
    expect(a.status).toBe('belum_ada');
    expect(a.reason).toMatch(/Tidak ada depot/);
    expect(sources.prospectAggregates).not.toHaveBeenCalled();
  });

  it('a network reader with no depot yet is still answered', async () => {
    const { service } = make({ scope: NONE, rows: [row(null, 4)] });
    expect((await service.answer('B-02', ADMIN, Q, CLOSED)).status).toBe('ok');
  });

  it('too many depots for one read is belum_ada, never a cut', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `d${i}`);
    const many: ReadScope = { spans: ids.map((depotId) => ({ depotId, legalEntityId: PT_A, from: '2026-11-01', to: '2026-11-30' })), echo: { depotIds: ids, legalEntityIds: [] } };
    const { service, sources } = make({ scope: many });
    const a = await service.answer('B-02', KEPALA, Q, CLOSED);
    expect(a.status).toBe('belum_ada');
    expect(a.reason).toMatch(/Terlalu banyak/);
    expect(sources.prospectAggregates).not.toHaveBeenCalled();
  });
});

describe('a depot that joined a readable entity mid-month', () => {
  const span = (depotId: string, from: string, to: string) => ({ depotId, legalEntityId: PT_A, from, to });
  const scopeOf = (spans: ReadScope['spans']): ReadScope => ({ spans, echo: { depotIds: [...new Set(spans.map((x) => x.depotId))].sort(), legalEntityIds: [PT_A] } });
  const ids = (m: ReturnType<typeof make>) => (m.sources.prospectAggregates.mock.calls[0][0] as { depotIds: string[] }).depotIds;
  const MOVED = scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-10', '2026-11-30')]);

  it.each(['B-02', 'B-03'])('%s leaves it out of the month it joined and counts it in the next', async (id) => {
    const nov = make({ rows: [], scope: MOVED });
    await nov.service.answer(id, KEPALA, Q, CLOSED);
    expect(ids(nov)).toEqual([D1]);
    const dec = make({ rows: [], scope: scopeOf([span(D1, '2026-12-01', '2026-12-31'), span(D2, '2026-12-01', '2026-12-31')]) });
    await dec.service.answer(id, KEPALA, { month: '2026-12' }, new Date('2027-01-05T03:00:00Z'));
    expect(ids(dec)).toEqual([D1, D2]);
  });

  it('adjacent spans that together cover every day of the month count', async () => {
    const m = make({ rows: [], scope: scopeOf([span(D1, '2026-11-01', '2026-11-14'), span(D1, '2026-11-15', '2026-11-30')]) });
    await m.service.answer('B-02', KEPALA, Q, CLOSED);
    expect(ids(m)).toEqual([D1]);
  });

  it('a gap of one day leaves the depot out, and a caller left with no depot is belum_ada', async () => {
    const m = make({ rows: [], scope: scopeOf([span(D1, '2026-11-01', '2026-11-14'), span(D1, '2026-11-16', '2026-11-30')]) });
    const a = await m.service.answer('B-03', KEPALA, Q, CLOSED);
    expect(a.status).toBe('belum_ada');
    expect(a.reason).toMatch(/Tidak ada depot/);
    expect(m.sources.prospectAggregates).not.toHaveBeenCalled();
  });

  it('B-01 counts it only once it is covered today', async () => {
    const before = make({ rows: [], scope: MOVED });
    await before.service.answer('B-01', KEPALA, Q, new Date('2026-11-05T03:00:00Z'));
    expect(ids(before)).toEqual([D1]);
    const after = make({ rows: [], scope: MOVED });
    await after.service.answer('B-01', KEPALA, Q, RUNNING);
    expect(ids(after)).toEqual([D1, D2]);
  });

  it('a network reader keeps counting every depot', async () => {
    const m = make({ rows: [], scope: MOVED });
    await m.service.answer('B-02', ADMIN, Q, CLOSED);
    expect(m.sources.prospectAggregates.mock.calls[0][0]).toMatchObject({ depotIds: null });
  });
});

describe('the month', () => {
  it('B-02 and B-03 are held while the month runs, until its last minute, and answered from day 1 of the next month (WIB)', async () => {
    for (const id of ['B-02', 'B-03']) {
      const { service, sources } = make({ rows: [row(KEC(1), 5)] });
      expect((await service.answer(id, KEPALA, Q, RUNNING)).status).toBe('ditahan');
      const late = await service.answer(id, KEPALA, Q, LAST_MINUTE);
      expect(late.status).toBe('ditahan');
      expect(late.reason).toMatch(/1 bulan berikutnya/);
      expect(sources.prospectAggregates).not.toHaveBeenCalled();
      expect((await service.answer(id, KEPALA, Q, CLOSED)).status).toBe('ok');
    }
  });

  it('B-01 is the stock now: only the running month, with no closed-month wait', async () => {
    const { service } = make({ rows: [row(KEC(1), 5, { dataAgeDaysMedian: 12 })] });
    const a = await service.answer('B-01', KEPALA, Q, RUNNING);
    expect(a.status).toBe('ok');
    expect(a.unit).toBe('usaha');
    await expect(service.answer('B-01', KEPALA, { month: '2026-10' }, RUNNING)).rejects.toThrow(BadRequestException);
    await expect(service.answer('B-01', KEPALA, Q, CLOSED)).rejects.toThrow(/bulan berjalan/);
  });

  it('B-01 is the stock of prospects not yet converted: its status keys and label say so', async () => {
    const six = { NEW: 3, CONTACTED: 3, VISITED: 0, INTERESTED: 0, LOST: 0, DO_NOT_CONTACT: 0 };
    const a = await make({ rows: [row(KEC(1), 6, { byStatus: six, byCategory: { KOS: 6 }, withPhone: 6, dataAgeDaysMedian: 3 })] }).service.answer('B-01', KEPALA, Q, RUNNING);
    expect(a.label).toMatch(/belum menjadi pelanggan/);
    const keys = (cellsOf(a)[0].byStatus as { key: string }[]).map((x) => x.key);
    expect(keys).toHaveLength(6);
    expect(keys).not.toContain('CONVERTED');
  });

  it('a source with more cells than one answer carries is belum_ada', async () => {
    const m = make({ rows: 'tooMany' as never });
    const a = await m.service.answer('B-02', KEPALA, { ...Q, level: 'grid' }, CLOSED);
    expect(a.status).toBe('belum_ada');
    expect(a.reason).toMatch(/Terlalu banyak sel/);
    expect(a.value).toBeNull();
  });

  it('a metric outside the group is 404', async () => {
    await expect(make().service.answer('B-09', KEPALA, Q, CLOSED)).rejects.toThrow(NotFoundException);
  });
});

describe('masking', () => {
  it('holds a cell of 1 or 2 and its smallest neighbour until the held count reaches 6, and keeps the total', async () => {
    const rows = [row(KEC(1), 10), row(KEC(2), 2), row(KEC(3), 4), row(KEC(4), 1)];
    const a = await make({ rows }).service.answer('B-02', KEPALA, Q, CLOSED);
    const v = a.value as { cells: Cells; total: number | null };
    expect(v.cells.map((c) => [c.id, c.total, c.flag])).toEqual([
      [KEC(1), 10, undefined],
      [KEC(2), null, 'kurang dari 3'],
      [KEC(3), null, 'ditahan'],
      [KEC(4), null, 'kurang dari 3'],
    ]);
    expect(v.total).toBe(17);
  });

  it('holds the whole answer when every cell is too small, or the neighbours cannot cover the held one', async () => {
    expect((await make({ rows: [row(KEC(1), 10), row(KEC(2), 1)] }).service.answer('B-02', KEPALA, Q, CLOSED)).status).toBe('ditahan');
    const a = await make({ rows: [row(KEC(1), 2), row(KEC(2), 1)] }).service.answer('B-02', KEPALA, Q, CLOSED);
    expect(a.status).toBe('ditahan');
    expect(a.reason).toMatch(/kurang dari 3/);
  });

  it('an empty answer is a real 0, not a hold', async () => {
    const a = await make({ rows: [] }).service.answer('B-02', KEPALA, Q, CLOSED);
    expect(a.status).toBe('ok');
    expect(a.value).toEqual({ level: 'kecamatan', cells: [], total: 0 });
  });

  it('at kelurahan level holds a sibling inside a kecamatan whose held mass is 1 or 2', async () => {
    const rows = [
      row(KEL(1, 1), 1, { parent: KEC(1) }),
      row(KEL(1, 2), 20, { parent: KEC(1) }),
      row(KEL(1, 6), 30, { parent: KEC(1) }),
      row(KEL(2, 3), 2, { parent: KEC(2) }),
      row(KEL(2, 4), 2, { parent: KEC(2) }),
      row(KEL(2, 5), 2, { parent: KEC(2) }),
    ];
    const a = await make({ rows }).service.answer('B-02', KEPALA, { ...Q, level: 'kelurahan' }, CLOSED);
    const byId = Object.fromEntries(cellsOf(a).map((c) => [c.id as string, [c.total, c.flag]]));
    expect(byId[KEL(1, 1)]).toEqual([null, 'kurang dari 3']);
    expect(byId[KEL(1, 2)]).toEqual([null, 'ditahan']);
    expect(byId[KEL(1, 6)]).toEqual([30, undefined]);
    expect((a.value as { total: number | null }).total).toBe(57);
  });

  it('a breakdown entry of 1 or 2 inside a published cell is held, with the complement', async () => {
    const rows = [row(KEC(1), 20, { byCategory: { KOS: 10, SALON: 2, LAUNDRY: 4, BENGKEL: 4 } })];
    const a = await make({ rows }).service.answer('B-02', KEPALA, Q, CLOSED);
    expect((cellsOf(a)[0].byCategory as unknown[])).toEqual([
      { key: 'BENGKEL', count: null, flag: 'ditahan' },
      { key: 'KOS', count: 10 },
      { key: 'LAUNDRY', count: 4 },
      { key: 'SALON', count: null, flag: 'kurang dari 3' },
    ]);
  });

  it('a breakdown that cannot be hidden from the cell total is held whole', async () => {
    const rows = [row(KEC(1), 5, { byCategory: { KOS: 4, SALON: 1 } })];
    const a = await make({ rows }).service.answer('B-02', KEPALA, Q, CLOSED);
    expect(cellsOf(a)[0].total).toBe(5);
    expect(cellsOf(a)[0].byCategory).toEqual([
      { key: 'KOS', count: null, flag: 'ditahan' },
      { key: 'SALON', count: null, flag: 'ditahan' },
    ]);
  });

  it('B-01: phone coverage as a percentage with one decimal, null when either side is 1 or 2, 0 when none', async () => {
    const stock = (withPhone: number, total: number) => row(KEC(1), total, { withPhone, byCategory: { KOS: total }, byStatus: { NEW: total }, dataAgeDaysMedian: 30 });
    const a = async (withPhone: number, total: number) =>
      cellsOf(await make({ rows: [stock(withPhone, total)] }).service.answer('B-01', KEPALA, Q, RUNNING))[0];
    expect(await a(7, 21)).toMatchObject({ total: 21, withPhone: 7, withPhonePct: 33.3, dataAgeDaysMedian: 30 });
    expect(await a(0, 12)).toMatchObject({ withPhone: 0, withPhonePct: 0 });
    expect(await a(12, 12)).toMatchObject({ withPhone: 12, withPhonePct: 100 });
    expect(await a(1, 12)).toMatchObject({ withPhone: null, withPhonePct: null });
    expect(await a(11, 12)).toMatchObject({ withPhone: null, withPhonePct: null });
    expect(await a(2, 3)).toMatchObject({ withPhone: null, withPhonePct: null });
    expect(await a(3, 6)).toMatchObject({ withPhone: 3, withPhonePct: 50 });
  });

  it('B-03: distinct businesses visited is null when 1 or 2, and the visits keep their outcomes', async () => {
    const visits = (n: number) => row(KEC(1), 9, { prospectsVisited: n, byOutcome: { MET_DECISION_MAKER: 5, NOT_THERE: 4 } });
    const c = async (n: number) => cellsOf(await make({ rows: [visits(n)] }).service.answer('B-03', KEPALA, Q, CLOSED))[0];
    expect(await c(1)).toMatchObject({ total: 9, prospectsVisited: null });
    expect(await c(2)).toMatchObject({ prospectsVisited: null });
    expect(await c(0)).toMatchObject({ prospectsVisited: 0 });
    expect(await c(6)).toMatchObject({ prospectsVisited: 6 });
    expect((await c(6)).byOutcome).toEqual([
      { key: 'MET_DECISION_MAKER', count: 5 },
      { key: 'NOT_THERE', count: 4 },
    ]);
  });
});

describe('cells', () => {
  it('depot level names the depots and marks the opportunity bucket; a depot it cannot name has no label', async () => {
    const rows = [row(D1, 6), row(D2, 6), row(null, 5), row('33333333-3333-4333-8333-333333333333', 5)];
    const a = await make({ rows, scope: ALL }).service.answer('B-02', ADMIN, { ...Q, level: 'depot' }, CLOSED);
    expect(cellsOf(a).map((c) => [c.id, c.label, c.opportunity])).toEqual([
      ['11111111-1111-4111-8111-111111111111', 'Depot Satu', undefined],
      ['22222222-2222-4222-8222-222222222222', 'Depot Dua', undefined],
      ['33333333-3333-4333-8333-333333333333', null, undefined],
      [null, 'di luar area depot', true],
    ]);
  });

  it('depot level lists the network itself when the scope did not, and survives it being unreadable', async () => {
    const own = make({ rows: [row(D1, 6)] });
    expect(cellsOf(await own.service.answer('B-02', KEPALA, { ...Q, level: 'depot' }, CLOSED))[0].label).toBe('Depot Satu');
    expect(own.depots.allDepots).toHaveBeenCalledTimes(1);
    const down = make({ rows: [row(D1, 6)], allDepots: null });
    expect(cellsOf(await down.service.answer('B-02', KEPALA, { ...Q, level: 'depot' }, CLOSED))[0].label).toBeNull();
  });

  it('the other levels never read the depot list', async () => {
    const m = make({ rows: [row(KEC(1), 6)] });
    await m.service.answer('B-02', KEPALA, Q, CLOSED);
    expect(m.depots.allDepots).not.toHaveBeenCalled();
  });

  it('kecamatan: a cell with no kecamatan is tidak diketahui and sorts last', async () => {
    const a = await make({ rows: [row(null, 5), row(KEC(2), 5), row(KEC(1), 5)] }).service.answer('B-02', KEPALA, Q, CLOSED);
    expect(cellsOf(a).map((c) => [c.id, c.label])).toEqual([
      [KEC(1), `Wilayah ${KEC(1)}`],
      [KEC(2), `Wilayah ${KEC(2)}`],
      [null, 'tidak diketahui'],
    ]);
  });

  it('kelurahan: a cell with a kecamatan but no kelurahan stays under that kecamatan', async () => {
    const rows = [row(KEL(1, 1), 5, { parent: KEC(1) }), row(null, 5, { parent: KEC(1) }), row(null, 5)];
    const cells = cellsOf(await make({ rows }).service.answer('B-02', KEPALA, { ...Q, level: 'kelurahan' }, CLOSED));
    expect(cells.map((c) => [c.id, c.label, c.kecamatan])).toEqual([
      [KEL(1, 1), `Wilayah ${KEL(1, 1)}`, KEC(1)],
      [null, 'Kelurahan tidak diketahui', KEC(1)],
      [null, 'tidak diketahui', undefined],
    ]);
  });

  it('grid: the id and the centre of the 1 km cell, never a coordinate of a business', async () => {
    const id = gridCell1km(-6.2, 106.8);
    const cells = cellsOf(await make({ rows: [row(id, 5), row(null, 5)] }).service.answer('B-02', KEPALA, { ...Q, level: 'grid' }, CLOSED));
    expect(cells[0].id).toBe(id);
    expect(Math.abs((cells[0].lat as number) + 6.2)).toBeLessThan(0.01);
    expect(Math.abs((cells[0].lng as number) - 106.8)).toBeLessThan(0.01);
    expect(cells[1]).toMatchObject({ id: null, label: null });
    expect(cells[1].lat).toBeUndefined();
  });

  it('a source that cannot answer is belum_ada, never a partial sum', async () => {
    const a = await make({ rows: null }).service.answer('B-02', KEPALA, Q, CLOSED);
    expect(a.status).toBe('belum_ada');
    expect(a.value).toBeNull();
  });

  it('says what the numbers are, for the network and for a depot caller', async () => {
    const net = await make({ rows: [row(KEC(1), 5)], scope: ALL }).service.answer('B-01', ADMIN, Q, RUNNING);
    expect(net.label).toMatch(/ditambah usaha di luar area semua depot/);
    expect(net.label).toMatch(/Sumber: customer-service/);
    const own = await make({ rows: [row(KEC(1), 5)] }).service.answer('B-03', KEPALA, Q, CLOSED);
    expect(own.label).not.toMatch(/di luar area/);
  });
});

/** Walks a value and collects every key it uses, and every cells[].id. */
function inspect(v: unknown, path: string[] = [], out = { keys: new Set<string>(), ids: [] as unknown[] }) {
  if (Array.isArray(v)) v.forEach((x) => inspect(x, path, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'id' && path[path.length - 1] === 'cells') out.ids.push(x);
      else out.keys.add(k);
      inspect(x, [...path, k], out);
    }
  }
  return out;
}
const FORBIDDEN = ['name', 'nameKey', 'phone', 'phoneE164', 'contactName', 'address', 'note', 'latitude', 'longitude', 'prospectId', 'customerId', 'assignedToId', 'visitorId', 'sourceId', 'licence', 'license', 'id'];
const ID_SHAPE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{7,10}|-?\d+:-?\d+)$/;

describe('what never leaves', () => {
  const fixture = (level: string): ProspectAggregate[] => {
    const rich = { byCategory: { KOS: 6 }, byStatus: { NEW: 6 }, byOutcome: { REFUSED: 6 }, withPhone: 6, dataAgeDaysMedian: 4, prospectsVisited: 5 };
    const key = { depot: D1, kecamatan: KEC(1), kelurahan: KEL(1, 1), grid: gridCell1km(-6.2, 106.8) }[level] as string;
    return [row(key, 6, { ...rich, parent: level === 'kelurahan' ? KEC(1) : null }), row(null, 6, rich), row(KEC(9), 1, rich)];
  };

  it.each(PROSPECT_METRIC_IDS.flatMap((m) => ['depot', 'kecamatan', 'kelurahan', 'grid'].map((l) => [m, l])))('%s at level %s carries only counts, codes and region names', async (metric, level) => {
    const now = metric === 'B-01' ? RUNNING : CLOSED;
    const a = await make({ rows: fixture(level), scope: ALL }).service.answer(metric, ADMIN, { ...Q, level }, now);
    expect(a.status).toBe('ok');
    const { keys, ids } = inspect(a.value);
    for (const bad of FORBIDDEN) expect(keys.has(bad)).toBe(false);
    for (const id of ids) expect(id === null || ID_SHAPE.test(String(id))).toBe(true);
  });

  it('a business name and a phone in the source reply never reach the answer', async () => {
    const reply = {
      cells: [
        {
          key: KEC(1),
          parent: null,
          name: 'Kecamatan Satu',
          total: 6,
          byCategory: { KOS: 6 },
          nameKey: 'kos mawar sari',
          contactName: 'Ibu Mawar',
          phoneE164: '+6281234567890',
          address: 'Jl. Melati 5',
          latitude: -6.2123456,
          longitude: 106.8123456,
          customerId: 'c1111111-1111-4111-8111-111111111111',
          note: 'Kos Mawar Sari',
        },
      ],
    };
    jest.spyOn(global, 'fetch').mockImplementation(async () => ({ ok: true, status: 200, json: async () => reply }) as unknown as Response);
    const adapter = new AiProspectSourcesHttpAdapter({ customerServiceUrl: 'http://customer.test', internalServiceKey: 'k' } as never);
    const scopes = { resolve: jest.fn(async () => ONE) } as unknown as ReadScopeService;
    const service = new ProspectMetricsService(scopes, adapter, { aiGrants: jest.fn() } as never, { allDepots: jest.fn() } as never);
    const a = await service.answer('B-02', KEPALA, Q, CLOSED);
    jest.restoreAllMocks();
    expect(a.status).toBe('ok');
    const json = JSON.stringify(a);
    for (const leak of ['Kos Mawar Sari', 'kos mawar sari', '+6281234567890', '6281234567890', 'Ibu Mawar', 'Melati', '6.2123456', '106.8123456', 'c1111111']) expect(json).not.toContain(leak);
    expect(json).toContain('Kecamatan Satu');
  });
});

describe('route, DTO and contract', () => {
  const n = async (body: object) => (await validate(plainToInstance(ProspectQueryDto, body))).length;

  it('validates the query', async () => {
    expect(await n({ metric: 'B-02', month: '2026-11' })).toBe(0);
    for (const level of ['depot', 'kecamatan', 'kelurahan', 'grid']) expect(await n({ metric: 'B-02', month: '2026-11', level })).toBe(0);
    expect(await n({ metric: 'B-02', month: '2026-13' })).toBeGreaterThan(0);
    expect(await n({ metric: 'B-02', month: '2026-11-05' })).toBeGreaterThan(0);
    expect(await n({ metric: 'B-02', month: '2026-11', level: 'rt' })).toBeGreaterThan(0);
    expect(await n({ month: '2026-11' })).toBeGreaterThan(0);
  });

  it('the controller hands the query and the caller to the service', async () => {
    const prospects = { answer: jest.fn().mockResolvedValue('answer') };
    const q = { metric: 'B-02', month: '2026-11', level: 'grid' };
    await expect(new AiReadProspectController(prospects as never).prospectMetric(ADMIN, q)).resolves.toBe('answer');
    expect(prospects.answer).toHaveBeenCalledWith('B-02', ADMIN, q);
  });

  it('is an AI-token route, never a machine route', () => {
    const handler = AiReadProspectController.prototype.prospectMetric;
    const keys = Reflect.getMetadataKeys(handler).map(String);
    expect(keys.some((k) => /external/i.test(k))).toBe(true);
    expect(keys.some((k) => /machine/i.test(k))).toBe(false);
    const external = keys.filter((k) => /external/i.test(k)).map((k) => Reflect.getMetadata(k, handler));
    expect(JSON.stringify(external)).toContain('ai');
    expect(JSON.stringify(external)).not.toContain('machine');
  });

  it('matches the contract the AI web codes against', () => {
    const contract = JSON.parse(readFileSync(join(__dirname, '../../../../contracts/ai-v1/read.openapi.json'), 'utf8'));
    const op = contract.paths['/dashboard/api/v1/ai/read/prospects'].get;
    expect(op.parameters.map((p: { name: string }) => p.name).sort()).toEqual(['level', 'metric', 'month']);
    expect(op.parameters.find((p: { name: string }) => p.name === 'metric').schema.enum).toEqual(PROSPECT_METRIC_IDS);
    expect(op.parameters.find((p: { name: string }) => p.name === 'level').schema.enum).toEqual(['depot', 'kecamatan', 'kelurahan', 'grid']);
    expect(Object.keys(op['x-metrics'])).toEqual(PROSPECT_METRIC_IDS);
    for (const id of PROSPECT_METRIC_IDS) {
      expect(op['x-metrics'][id].unit).toBe(PROSPECT_METRICS[id].unit);
      expect(op['x-metrics'][id].exactlyOneMonth).toBe(true);
    }
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '500', '503']);
    const schema = contract.components.schemas.AnswerEnvelope;
    const example = op.responses['200'].content['application/json'].example;
    for (const field of schema.required) expect(example).toHaveProperty(field);
    for (const field of Object.keys(example)) expect(Object.keys(schema.properties)).toContain(field);
  });
});

describe('AiProspectSourcesHttpAdapter', () => {
  const adapter = (customer: string | undefined = 'http://customer.test') =>
    new AiProspectSourcesHttpAdapter({ customerServiceUrl: customer, internalServiceKey: 'k' } as never);
  const FAR = Date.now() + 3_600_000;
  const query = { kind: 'stock', level: 'kecamatan', month: '2026-11', depotIds: [D1], opportunity: false } as const;

  function answer(body: unknown, ok = true) {
    const calls: { url: URL; init?: RequestInit }[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: new URL(String(input)), init });
      if (body === 'throw') throw new Error('network down');
      return { ok, status: ok ? 200 : 503, json: async () => body } as unknown as Response;
    });
    return calls;
  }
  afterEach(() => jest.restoreAllMocks());

  it('posts the query to customer-service with the internal key and reads the cells, copying only what it knows', async () => {
    const calls = answer({
      cells: [
        { key: KEC(1), parent: null, name: 'Kec', total: 4, byCategory: { KOS: 4 }, byStatus: { NEW: 4 }, withPhone: 2, dataAgeDaysMedian: 9, extra: 'dropped' },
        { key: null, parent: null, name: null, total: 1, byOutcome: { REFUSED: 1 }, prospectsVisited: 1 },
      ],
    });
    await expect(adapter().prospectAggregates(query, FAR)).resolves.toEqual([
      { key: KEC(1), parent: null, name: 'Kec', total: 4, byCategory: { KOS: 4 }, byStatus: { NEW: 4 }, withPhone: 2, dataAgeDaysMedian: 9 },
      { key: null, parent: null, name: null, total: 1, byOutcome: { REFUSED: 1 }, prospectsVisited: 1 },
    ]);
    expect(calls[0].url.pathname).toBe('/api/v1/customers/internal/prospect-aggregates');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(query);
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it('a reply flagged tooMany is the too-many-cells marker, not a list', async () => {
    answer({ cells: [], tooMany: true });
    await expect(adapter().prospectAggregates(query, FAR)).resolves.toBe('tooMany');
  });

  it('sends null for every depot', async () => {
    const calls = answer({ cells: [] });
    await expect(adapter().prospectAggregates({ ...query, depotIds: null, opportunity: true }, FAR)).resolves.toEqual([]);
    expect(JSON.parse(String(calls[0].init?.body)).depotIds).toBeNull();
  });

  it.each([
    ['a key of the wrong level', { cells: [{ key: 'not-a-code', parent: null, name: null, total: 1 }] }],
    ['a free-text parent', { cells: [{ key: KEC(1), parent: 'Jl. Melati', name: null, total: 1 }] }],
    ['a number as a name', { cells: [{ key: KEC(1), parent: null, name: 7, total: 1 }] }],
    ['a negative total', { cells: [{ key: KEC(1), parent: null, name: null, total: -1 }] }],
    ['a fractional total', { cells: [{ key: KEC(1), parent: null, name: null, total: 1.5 }] }],
    ['a category that is free text', { cells: [{ key: KEC(1), parent: null, name: null, total: 1, byCategory: { 'Kos Mawar': 1 } }] }],
    ['a breakdown that is not a map', { cells: [{ key: KEC(1), parent: null, name: null, total: 1, byStatus: [1] }] }],
    ['a median that is a string', { cells: [{ key: KEC(1), parent: null, name: null, total: 1, dataAgeDaysMedian: '3' }] }],
    ['a cell that is not an object', { cells: ['x'] }],
    ['no cells', { nope: 1 }],
    ['not an object', 'oops'],
  ])('reads %s as no answer', async (_n, body) => {
    answer(body);
    await expect(adapter().prospectAggregates(query, FAR)).resolves.toBeNull();
  });

  it('checks the key against the level it asked for', async () => {
    answer({ cells: [{ key: D1, parent: null, name: null, total: 1 }] });
    await expect(adapter().prospectAggregates({ ...query, level: 'depot' }, FAR)).resolves.toHaveLength(1);
    answer({ cells: [{ key: '3:-4', parent: null, name: null, total: 1 }] });
    await expect(adapter().prospectAggregates({ ...query, level: 'grid' }, FAR)).resolves.toHaveLength(1);
    answer({ cells: [{ key: D1, parent: null, name: null, total: 1 }] });
    await expect(adapter().prospectAggregates({ ...query, level: 'grid' }, FAR)).resolves.toBeNull();
  });

  it('is null on a non-2xx, a network failure, an unwired service and a passed deadline', async () => {
    answer({ cells: [] }, false);
    await expect(adapter().prospectAggregates(query, FAR)).resolves.toBeNull();
    answer('throw');
    await expect(adapter().prospectAggregates(query, FAR)).resolves.toBeNull();
    const calls = answer({ cells: [] });
    await expect(new AiProspectSourcesHttpAdapter({ customerServiceUrl: '', internalServiceKey: 'k' } as never).prospectAggregates(query, FAR)).resolves.toBeNull();
    await expect(adapter().prospectAggregates(query, Date.now() - 1)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
