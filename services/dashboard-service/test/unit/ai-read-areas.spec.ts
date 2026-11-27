import 'reflect-metadata';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AuthenticatedUser, gridCell1km } from '@hydromart/platform';

import { AREA_METRIC_IDS, AREA_METRICS, AreaMetricsService } from '../../src/application/ai-read/area-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { AreaPin, RegionHit } from '../../src/application/ports/ai-area-sources.port';
import { LOOKUP_CHUNK, LOOKUP_PARALLEL, AiAreaSourcesHttpAdapter } from '../../src/infrastructure/http/ai-area-sources.http.adapter';
import { AiReadAreaController } from '../../src/modules/ai-read-area.controller';
import { AreaQueryDto } from '../../src/modules/dto/ai-read-area.dto';

/*
 * HD-20c: served (R-01) and unserved (R-02) demand per area. The sources are stubbed; under test are the
 * cell counts (a customer in two cells counts in both, once in the total), masking with the complement held
 * back, the scope rules, the closed-month rule, and that nothing identifying is ever answered.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLOSED = new Date('2026-12-08T03:00:00.000Z'); // November settles on 8 Dec (WIB)
const BEFORE_8TH = new Date('2026-12-07T03:00:00.000Z');
const RUNNING = new Date('2026-11-25T03:00:00.000Z');
const Q = { month: '2026-11' };
const ADMIN = { sub: 'u1', role: 'SUPER_ADMIN', depotId: null } as unknown as AuthenticatedUser;
const FINANCE = { sub: 'u2', role: 'FINANCE', depotId: null } as unknown as AuthenticatedUser;
const KEPALA = { sub: 'u3', role: 'KEPALA_DEPOT', depotId: D1, depotIds: [D1] } as unknown as AuthenticatedUser;
const MACHINE = { sub: 'm1', role: 'SUPER_ADMIN', depotId: null, via: 'machine' } as unknown as AuthenticatedUser;

const ONE: ReadScope = {
  spans: [{ depotId: D1, legalEntityId: PT_A, from: '2026-11-01', to: '2026-11-30' }],
  echo: { depotIds: [D1], legalEntityIds: [PT_A] },
};
const NONE: ReadScope = { spans: [], echo: { depotIds: [], legalEntityIds: [] } };

const kec = (code: string): RegionHit => ({ kecamatan: { code, name: `Kec ${code}` }, kelurahan: { code: `${code}01`, name: `Kel ${code}` }, gridCell: '1:1' });
const NO_REGION: RegionHit = { kecamatan: null, kelurahan: null, gridCell: '9:9' };
/** `n` customers numbered from `from`, each with one pin and 2 orders of 3 gallons. */
const people = (from: number, n: number, lat: number, lng: number): AreaPin[] =>
  Array.from({ length: n }, (_, i) => ({ k: from + i, lat, lng, orders: 2, galon: 3 }));

function make(opts: { pins?: AreaPin[] | null; scope?: ReadScope; hits?: Record<string, RegionHit | null>; grants?: { all: boolean } | null; unserved?: unknown } = {}) {
  const sources = {
    areaPins: jest.fn(async () => (opts.pins === undefined ? [] : opts.pins)),
    lookupRegions: jest.fn(async (pts: { lat: number; lng: number }[]) => (opts.hits === undefined ? null : pts.map((p) => opts.hits![`${p.lat},${p.lng}`] ?? NO_REGION))),
    unservedDemand: jest.fn(async () => (opts.unserved === undefined ? null : opts.unserved)),
  };
  const scopes = { resolve: jest.fn(async () => opts.scope ?? ONE) } as unknown as ReadScopeService;
  const grants = { aiGrants: jest.fn(async () => (opts.grants === undefined ? { all: true, legalEntityIds: [] } : opts.grants)) };
  return { sources, service: new AreaMetricsService(scopes, sources as never, grants as never), grants };
}

describe('R-01 served demand', () => {
  // X: 6 customers, Z: 4 and customer 0 (who also ordered in X) = 5, Y: 2; 12 distinct people in all
  const pins = [...people(0, 6, 1, 1), ...people(6, 4, 2, 2), ...people(10, 2, 3, 3), { k: 0, lat: 2, lng: 2, orders: 1, galon: 0 }];
  const hits = { '1,1': kec('X'), '2,2': kec('Z'), '3,3': kec('Y') };

  it('counts distinct customers per kecamatan, holds a cell of 2 back with its smallest neighbour, and publishes orders only for the rest', async () => {
    const { service, sources } = make({ pins, hits });
    const a = await service.answer('R-01', ADMIN, Q, CLOSED);
    expect(a.status).toBe('ok');
    const v = a.value as { level: string; cells: Record<string, unknown>[]; total: number | null };
    expect(v.level).toBe('kecamatan');
    // customer 0 is in X and in Z, but once in the total of 12
    expect(v.total).toBe(12);
    expect(v.cells).toEqual([
      { id: 'X', label: 'Kec X', customers: 6, orders: 12, galon: 18 },
      { id: 'Y', label: 'Kec Y', customers: null, flag: 'kurang dari 3', orders: null, galon: null },
      { id: 'Z', label: 'Kec Z', customers: null, flag: 'ditahan', orders: null, galon: null },
    ]);
    // the pins were asked for the readable stretches of the month only, and looked up once per distinct pin
    expect(sources.areaPins).toHaveBeenCalledWith([{ depotId: D1, from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' }], expect.any(Number));
    expect(sources.lookupRegions.mock.calls[0][0]).toHaveLength(3);
  });

  it('is held whole when the held people never reach 6 (every cell ends up held)', async () => {
    const { service } = make({ pins: [...people(0, 3, 1, 1), ...people(3, 2, 3, 3)], hits });
    expect((await service.answer('R-01', ADMIN, Q, CLOSED)).status).toBe('ditahan');
  });

  it('puts orders without a pin, and a pin in no kecamatan, in one tidak diketahui cell', async () => {
    const lost: AreaPin[] = [...people(0, 3, 1, 1), ...people(3, 2, 50, 50), { k: 5, lat: null, lng: null, orders: 4, galon: 1 }, ...people(6, 2, 51, 51)];
    const { service } = make({ pins: lost, hits });
    const v = (await service.answer('R-01', ADMIN, Q, CLOSED)).value as { cells: { id: string | null; label: string; customers: number | null }[] };
    const unknown = v.cells.filter((c) => c.id === null);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ label: 'tidak diketahui', customers: 5, orders: 12, galon: 13 });
    expect(v.cells[v.cells.length - 1].id).toBeNull();
  });

  it('answers per kelurahan with its own codes', async () => {
    const { service } = make({ pins: people(0, 3, 1, 1), hits });
    const v = (await service.answer('R-01', ADMIN, { ...Q, level: 'kelurahan' }, CLOSED)).value as { level: string; cells: { id: string }[] };
    expect(v.level).toBe('kelurahan');
    expect(v.cells[0].id).toBe('X01');
  });

  it('answers per 1 km cell with its id and centre, and never calls the region source', async () => {
    const { service, sources } = make({ pins: people(0, 3, -6.2, 106.8) });
    const v = (await service.answer('R-01', ADMIN, { ...Q, level: 'grid' }, CLOSED)).value as { cells: { id: string; lat: number; lng: number; customers: number }[] };
    expect(sources.lookupRegions).not.toHaveBeenCalled();
    expect(v.cells).toHaveLength(1);
    expect(v.cells[0].id).toBe(gridCell1km(-6.2, 106.8));
    expect(Math.abs(v.cells[0].lat + 6.2)).toBeLessThan(0.01);
    expect(Math.abs(v.cells[0].lng - 106.8)).toBeLessThan(0.01);
    expect(v.cells[0].customers).toBe(3);
  });

  it('never carries a raw coordinate, an id or a customer number out', async () => {
    const { service } = make({ pins: people(0, 3, -6.2123456, 106.8123456), hits: {} });
    const json = JSON.stringify(await service.answer('R-01', ADMIN, Q, CLOSED));
    expect(json).not.toContain('6.2123456');
    expect(json).not.toContain('106.8123456');
    expect(json).not.toContain('"k"');
  });

  it('is held when every cell is too small', async () => {
    const { service } = make({ pins: [...people(0, 2, 1, 1), ...people(2, 1, 2, 2)], hits });
    const a = await service.answer('R-01', ADMIN, Q, CLOSED);
    expect(a.status).toBe('ditahan');
    expect(a.reason).toMatch(/kurang dari 3/);
  });

  it('refuses a running month and a closed month before the 8th, and answers on the 8th', async () => {
    const { service, sources } = make({ pins, hits });
    expect((await service.answer('R-01', ADMIN, Q, RUNNING)).status).toBe('ditahan');
    expect((await service.answer('R-01', ADMIN, Q, BEFORE_8TH)).status).toBe('ditahan');
    expect(sources.areaPins).not.toHaveBeenCalled();
    expect((await service.answer('R-01', ADMIN, Q, CLOSED)).status).toBe('ok');
  });

  it('says belum_ada with no readable depot, no pin rows, a source that is down, or a region source that is down', async () => {
    expect((await make({ scope: NONE }).service.answer('R-01', KEPALA, Q, CLOSED)).status).toBe('belum_ada');
    expect((await make({ pins: [] }).service.answer('R-01', ADMIN, Q, CLOSED)).status).toBe('belum_ada');
    expect((await make({ pins: null }).service.answer('R-01', ADMIN, Q, CLOSED)).status).toBe('belum_ada');
    expect((await make({ pins }).service.answer('R-01', ADMIN, Q, CLOSED)).status).toBe('belum_ada');
    const many: ReadScope = { spans: Array.from({ length: 201 }, (_, i) => ({ depotId: D1, legalEntityId: PT_A, from: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, to: '2026-11-30' })), echo: ONE.echo };
    expect((await make({ pins, hits, scope: many }).service.answer('R-01', ADMIN, Q, CLOSED)).status).toBe('belum_ada');
  });

  it('a depot-scoped caller reads only its own depot (the scope it is given)', async () => {
    const { service, sources } = make({ pins, hits });
    await service.answer('R-01', KEPALA, Q, CLOSED);
    expect(sources.areaPins).toHaveBeenCalledWith([expect.objectContaining({ depotId: D1 })], expect.any(Number));
  });
});

describe('R-02 unserved demand', () => {
  const summary = {
    kecamatan: [{ code: 'X', name: 'Kec X', count: 8 }, { code: 'Y', name: 'Kec Y', count: 2 }, { code: 'Z', name: 'Kec Z', count: 5 }],
    kelurahan: [{ code: null, name: null, count: 3 }, { code: 'X01', name: 'Kel X', count: 12 }],
    grid: [{ cell: '-690:11866', count: 15 }],
    bands: [{ band: '>10', count: 9 }, { band: '3-5', count: 1 }, { band: '5-10', count: 5 }],
  };

  it('refuses a scoped caller and a role that does not read every legal entity, without reading anything', async () => {
    const m = make({ unserved: summary });
    const a = await m.service.answer('R-02', KEPALA, Q, CLOSED);
    expect(a.status).toBe('ditahan');
    expect(a.reason).toMatch(/seluruh|semua depot/);
    expect((await make({ unserved: summary, grants: { all: false } }).service.answer('R-02', FINANCE, Q, CLOSED)).status).toBe('ditahan');
    expect((await make({ unserved: summary, grants: null }).service.answer('R-02', FINANCE, Q, CLOSED)).status).toBe('ditahan');
    expect(m.sources.unservedDemand).not.toHaveBeenCalled();
  });

  it('answers a network reader (and a machine account) per kecamatan with masking, and the five distance bands', async () => {
    for (const who of [ADMIN, MACHINE]) {
      const { service, sources } = make({ unserved: summary });
      const a = await service.answer('R-02', who, Q, CLOSED);
      expect(a.status).toBe('ok');
      expect(a.unit).toBe('orang');
      expect(sources.unservedDemand).toHaveBeenCalledWith('2026-11', expect.any(Number));
      const v = a.value as { cells: Record<string, unknown>[]; total: number | null; bands: { band: string; people: number | null; flag?: string }[]; bandsTotal: number | null };
      expect(v.cells).toEqual([
        { id: 'X', label: 'Kec X', people: 8 },
        { id: 'Y', label: 'Kec Y', people: null, flag: 'kurang dari 3' },
        { id: 'Z', label: 'Kec Z', people: null, flag: 'ditahan' },
      ]);
      expect(v.total).toBe(15);
      expect(v.bands.map((b) => b.band)).toEqual(['0-1', '1-3', '3-5', '5-10', '>10']);
      expect(v.bands).toEqual([
        { band: '0-1', people: 0 },
        { band: '1-3', people: 0 },
        { band: '3-5', people: null, flag: 'kurang dari 3' },
        { band: '5-10', people: null, flag: 'ditahan' },
        { band: '>10', people: 9 },
      ]);
      expect(v.bandsTotal).toBe(15);
    }
  });

  it('names a kelurahan without a code "tidak diketahui" and a grid cell by id and centre', async () => {
    const { service } = make({ unserved: summary });
    const kel = (await service.answer('R-02', ADMIN, { ...Q, level: 'kelurahan' }, CLOSED)).value as { cells: { id: string | null; label: string; people: number }[] };
    expect(kel.cells[kel.cells.length - 1]).toMatchObject({ id: null, label: 'tidak diketahui', people: 3 });
    const grid = (await service.answer('R-02', ADMIN, { ...Q, level: 'grid' }, CLOSED)).value as { cells: { id: string; lat: number; lng: number }[] };
    expect(grid.cells[0]).toMatchObject({ id: '-690:11866' });
    expect(typeof grid.cells[0].lat).toBe('number');
  });

  it('refuses a running month, and says belum_ada for a source that is down or a month with nothing', async () => {
    const { service, sources } = make({ unserved: summary });
    expect((await service.answer('R-02', ADMIN, Q, BEFORE_8TH)).status).toBe('ditahan');
    expect(sources.unservedDemand).not.toHaveBeenCalled();
    expect((await make({ unserved: null }).service.answer('R-02', ADMIN, Q, CLOSED)).status).toBe('belum_ada');
    const empty = { kecamatan: [], kelurahan: [], grid: [], bands: [] };
    expect((await make({ unserved: empty }).service.answer('R-02', ADMIN, Q, CLOSED)).status).toBe('belum_ada');
  });
});

describe('the metric registry, the DTO and the route', () => {
  it('knows R-01 and R-02 only, one month each; any other id is a 404', async () => {
    expect(AREA_METRIC_IDS).toEqual(['R-01', 'R-02']);
    await expect(make().service.answer('R-09', ADMIN, Q, CLOSED)).rejects.toThrow(NotFoundException);
  });

  it('bounds the query', async () => {
    const n = async (body: object) => (await validate(plainToInstance(AreaQueryDto, body))).length;
    expect(await n({ metric: 'R-01', month: '2026-11' })).toBe(0);
    expect(await n({ metric: 'R-01', month: '2026-11', level: 'grid' })).toBe(0);
    expect(await n({ metric: 'R-01', month: '2026-13' })).toBeGreaterThan(0);
    expect(await n({ metric: 'R-01', month: '2026-11-05' })).toBeGreaterThan(0);
    expect(await n({ metric: 'R-01', month: '2026-11', level: 'rt' })).toBeGreaterThan(0);
    expect(await n({ month: '2026-11' })).toBeGreaterThan(0);
  });

  it('the controller hands the query and the caller to the service', async () => {
    const areas = { answer: jest.fn().mockResolvedValue('answer') };
    await expect(new AiReadAreaController(areas as never).areaMetric(ADMIN, { metric: 'R-01', month: '2026-11', level: 'grid' })).resolves.toBe('answer');
    expect(areas.answer).toHaveBeenCalledWith('R-01', ADMIN, { metric: 'R-01', month: '2026-11', level: 'grid' });
  });

  it('matches the contract the AI web codes against', () => {
    const contract = JSON.parse(readFileSync(join(__dirname, '../../../../contracts/ai-v1/read.openapi.json'), 'utf8'));
    const op = contract.paths['/dashboard/api/v1/ai/read/areas'].get;
    expect(op.parameters.map((p: { name: string }) => p.name).sort()).toEqual(['level', 'metric', 'month']);
    expect(op.parameters.find((p: { name: string }) => p.name === 'metric').schema.enum).toEqual(AREA_METRIC_IDS);
    expect(op.parameters.find((p: { name: string }) => p.name === 'level').schema.enum).toEqual(['kecamatan', 'kelurahan', 'grid']);
    expect(Object.keys(op['x-metrics'])).toEqual(AREA_METRIC_IDS);
    for (const id of AREA_METRIC_IDS) {
      expect(op['x-metrics'][id].unit).toBe(AREA_METRICS[id].unit);
      expect(op['x-metrics'][id].exactlyOneMonth).toBe(true);
    }
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '500', '503']);
    const schema = contract.components.schemas.AnswerEnvelope;
    const example = op.responses['200'].content['application/json'].example;
    for (const field of schema.required) expect(example).toHaveProperty(field);
    for (const field of Object.keys(example)) expect(Object.keys(schema.properties)).toContain(field);
  });
});

describe('AiAreaSourcesHttpAdapter (HD-20c)', () => {
  const adapter = (customer: string | undefined = 'http://customer.test') =>
    new AiAreaSourcesHttpAdapter({ orderServiceUrl: 'http://order.test', customerServiceUrl: customer, internalServiceKey: 'k' } as never);
  const SPANS = [{ depotId: D1, from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' }];
  const FAR = Date.now() + 3_600_000;

  function answer(body: unknown | ((url: URL, init?: RequestInit) => unknown), ok = true) {
    const calls: { url: URL; init?: RequestInit }[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      const b = typeof body === 'function' ? (body as (u: URL, i?: RequestInit) => unknown)(url, init) : body;
      if (b === 'throw') throw new Error('network down');
      return { ok, status: ok ? 200 : 503, json: async () => b } as unknown as Response;
    });
    return calls;
  }
  afterEach(() => jest.restoreAllMocks());

  it('posts the spans to order-service with the internal key and reads the pins', async () => {
    const pins = [{ k: 0, lat: -6.2, lng: 106.8, orders: 1, galon: 2 }, { k: 0, lat: null, lng: null, orders: 1, galon: 0 }];
    const calls = answer({ points: pins });
    await expect(adapter().areaPins(SPANS, FAR)).resolves.toEqual(pins);
    expect(calls[0].url.pathname).toBe('/api/v1/reports/internal/area-points');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ spans: SPANS });
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it.each([
    ['a customer id as k', { points: [{ k: 'c1111111-1111-4111-8111-111111111111', lat: 1, lng: 1, orders: 1, galon: 0 }] }],
    ['a pin off the planet', { points: [{ k: 0, lat: 91, lng: 1, orders: 1, galon: 0 }] }],
    ['a negative count', { points: [{ k: 0, lat: 1, lng: 1, orders: -1, galon: 0 }] }],
    ['no points', { nope: 1 }],
    ['not an object', 'oops'],
  ])('reads %s as no answer', async (_n, body) => {
    answer(body);
    await expect(adapter().areaPins(SPANS, FAR)).resolves.toBeNull();
  });

  it('is null for a failed or unreachable source, in every call', async () => {
    answer({}, false);
    await expect(adapter().areaPins(SPANS, FAR)).resolves.toBeNull();
    await expect(adapter().lookupRegions([{ lat: 1, lng: 1 }], FAR)).resolves.toBeNull();
    await expect(adapter().unservedDemand('2026-11', FAR)).resolves.toBeNull();
    answer('throw');
    await expect(adapter().areaPins(SPANS, FAR)).resolves.toBeNull();
  });

  it('looks pins up in chunks, in order, and rejects a short or odd answer', async () => {
    const total = LOOKUP_CHUNK + 5;
    const pts = Array.from({ length: total }, (_, i) => ({ lat: i / 100, lng: 1 }));
    const calls = answer((_u: URL, init?: RequestInit) => ({
      points: (JSON.parse(String(init?.body)).points as unknown[]).map(() => ({ kecamatan: { code: 'K', name: 'Kec' }, kelurahan: null, gridCell: '1:2' })),
    }));
    const hits = await adapter().lookupRegions(pts, FAR);
    expect(hits).toHaveLength(total);
    expect(hits?.[0]).toEqual({ kecamatan: { code: 'K', name: 'Kec' }, kelurahan: null, gridCell: '1:2' });
    expect(calls.map((c) => JSON.parse(String(c.init?.body)).points.length)).toEqual([LOOKUP_CHUNK, 5]);
    expect(calls[0].url.pathname).toBe('/api/v1/customers/internal/regions/lookup');
    answer({ points: [] });
    await expect(adapter().lookupRegions([{ lat: 1, lng: 1 }], FAR)).resolves.toBeNull();
    answer({ points: [{ kecamatan: 'x', kelurahan: null, gridCell: '1:2' }] });
    await expect(adapter().lookupRegions([{ lat: 1, lng: 1 }], FAR)).resolves.toBeNull();
    answer({ points: [{ kecamatan: null, kelurahan: null, gridCell: 'bad' }] });
    await expect(adapter().lookupRegions([{ lat: 1, lng: 1 }], FAR)).resolves.toBeNull();
    answer({ points: 'no' });
    await expect(adapter().lookupRegions([{ lat: 1, lng: 1 }], FAR)).resolves.toBeNull();
    answer({ points: ['no'] });
    await expect(adapter().lookupRegions([{ lat: 1, lng: 1 }], FAR)).resolves.toBeNull();
  });

  it('is null when customer-service is not wired', async () => {
    answer({});
    await expect(adapter(undefined).lookupRegions([{ lat: 1, lng: 1 }], FAR)).resolves.toBeNull();
    await expect(adapter(undefined).unservedDemand('2026-11', FAR)).resolves.toBeNull();
  });

  it('reads the unserved summary and refuses one it does not understand', async () => {
    const ok = {
      kecamatan: [{ code: 'K', name: 'Kec', count: 3 }],
      kelurahan: [{ code: null, name: null, count: 1 }],
      grid: [{ cell: '-1:2', count: 4 }],
      bands: [{ band: '>10', count: 4 }],
    };
    const calls = answer(ok);
    await expect(adapter().unservedDemand('2026-11', FAR)).resolves.toEqual(ok);
    expect(calls[0].url.pathname).toBe('/api/v1/customers/internal/unserved-demand');
    expect(calls[0].url.searchParams.get('month')).toBe('2026-11');
    for (const bad of [
      { ...ok, kecamatan: [{ code: 1, name: 'x', count: 1 }] },
      { ...ok, kelurahan: 'x' },
      { ...ok, grid: [{ cell: 'nope', count: 1 }] },
      { ...ok, bands: [{ band: 5, count: 1 }] },
      { ...ok, bands: undefined },
      'x',
    ]) {
      answer(bad);
      await expect(adapter().unservedDemand('2026-11', FAR)).resolves.toBeNull();
    }
  });
});

describe('period handling of the month', () => {
  it('a month the route validates is always a real month; a bad one never reaches parsePeriod as a 500', async () => {
    const { service } = make();
    await expect(service.answer('R-01', ADMIN, { month: '2026-00' }, CLOSED)).rejects.toThrow(BadRequestException);
  });
});

const SPANS_ONE = [{ depotId: D1, from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' }];

describe('HD-20c review fixes', () => {
  const hit = (kec: string, kel: string): RegionHit => ({ kecamatan: { code: kec, name: `K${kec}` }, kelurahan: { code: kel, name: `L${kel}` }, gridCell: '1:1' });

  it('holds more cells when the held people, counted once, are fewer than 3 (one person in several held cells)', async () => {
    const both = (lat: number): AreaPin[] => [0, 1].map((k) => ({ k, lat, lng: lat, orders: 1, galon: 1 }));
    const pins = [...both(1), ...both(2), ...both(3), ...people(2, 5, 4, 4), ...people(7, 6, 5, 5)];
    const hits = { '1,1': kec('A'), '2,2': kec('B'), '3,3': kec('C'), '4,4': kec('D'), '5,5': kec('E') };
    const v = (await make({ pins, hits }).service.answer('R-01', ADMIN, Q, CLOSED)).value as { cells: { id: string; customers: number | null; flag?: string }[]; total: number };
    expect(v.total).toBe(13);
    expect(v.cells.map((c) => [c.id, c.customers, c.flag])).toEqual([
      ['A', null, 'kurang dari 3'],
      ['B', null, 'kurang dari 3'],
      ['C', null, 'kurang dari 3'],
      ['D', null, 'ditahan'],
      ['E', 6, undefined],
    ]);
  });

  it('holds the sibling kelurahan of a kecamatan whose held people are 1 or 2 (kecamatan total minus kelurahan)', async () => {
    const pins = [...people(0, 5, 1, 1), ...people(5, 2, 2, 2), ...people(7, 2, 3, 3), ...people(9, 2, 4, 4), ...people(11, 2, 5, 5), ...people(13, 6, 6, 6)];
    const hits = {
      '1,1': hit('3203010', '3203010001'),
      '2,2': hit('3203010', '3203010002'),
      '3,3': hit('3273180', '3273180001'),
      '4,4': hit('3273180', '3273180002'),
      '5,5': hit('3273180', '3273180003'),
      '6,6': hit('3300010', '3300010001'),
    };
    const v = (await make({ pins, hits }).service.answer('R-01', ADMIN, { ...Q, level: 'kelurahan' }, CLOSED)).value as { cells: { id: string; customers: number | null; flag?: string }[] };
    expect(v.cells.map((c) => [c.id, c.customers, c.flag])).toEqual([
      ['3203010001', null, 'ditahan'],
      ['3203010002', null, 'kurang dari 3'],
      ['3273180001', null, 'kurang dari 3'],
      ['3273180002', null, 'kurang dari 3'],
      ['3273180003', null, 'kurang dari 3'],
      ['3300010001', 6, undefined],
    ]);
  });

  it('applies the same sibling rule to R-02 kelurahan counts', async () => {
    const unserved = {
      kecamatan: [],
      kelurahan: [
        { code: '3203010001', name: 'a', count: 5 },
        { code: '3203010002', name: 'b', count: 2 },
        { code: '3273180001', name: 'c', count: 2 },
        { code: '3273180002', name: 'd', count: 2 },
        { code: '3273180003', name: 'e', count: 2 },
        { code: '3300010001', name: 'f', count: 9 },
      ],
      grid: [],
      bands: [],
    };
    const v = (await make({ unserved }).service.answer('R-02', ADMIN, { ...Q, level: 'kelurahan' }, CLOSED)).value as { cells: { id: string; people: number | null }[] };
    expect(v.cells.map((c) => [c.id, c.people])).toEqual([
      ['3203010001', null],
      ['3203010002', null],
      ['3273180001', null],
      ['3273180002', null],
      ['3273180003', null],
      ['3300010001', 9],
    ]);
  });

  it('gives the whole read one deadline of 30 s and passes it to every source call', async () => {
    const before = Date.now();
    const { service, sources } = make({ pins: people(0, 3, 1, 1), hits: { '1,1': kec('X') } });
    await service.answer('R-01', ADMIN, Q, CLOSED);
    const d = (sources.areaPins.mock.calls[0] as unknown[])[1] as number;
    expect(d).toBeGreaterThanOrEqual(before + 29_000);
    expect(d).toBeLessThanOrEqual(Date.now() + 30_000);
    expect((sources.lookupRegions.mock.calls[0] as unknown[])[1]).toBe(d);
  });

  it('reads half a pin as no pin, not as a failure', async () => {
    const adapter = new AiAreaSourcesHttpAdapter({ orderServiceUrl: 'http://order.test', internalServiceKey: 'k' } as never);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ points: [{ k: 0, lat: 1, lng: null, orders: 1, galon: 0 }, { k: 1, lat: null, lng: 2, orders: 1, galon: 0 }] }),
    } as unknown as Response);
    await expect(adapter.areaPins(SPANS_ONE, Date.now() + 1000)).resolves.toEqual([
      { k: 0, lat: null, lng: null, orders: 1, galon: 0 },
      { k: 1, lat: null, lng: null, orders: 1, galon: 0 },
    ]);
    jest.restoreAllMocks();
  });

  it('does not call a source once the overall deadline has passed, and runs lookups 4 chunks at a time', async () => {
    const adapter = new AiAreaSourcesHttpAdapter({ orderServiceUrl: 'http://order.test', customerServiceUrl: 'http://customer.test', internalServiceKey: 'k' } as never);
    const spy = jest.spyOn(global, 'fetch');
    await expect(adapter.areaPins(SPANS_ONE, Date.now() - 1)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    let live = 0;
    let peak = 0;
    spy.mockImplementation(async (_u, init) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      const pts = JSON.parse(String((init as RequestInit).body)).points as unknown[];
      return { ok: true, status: 200, json: async () => ({ points: pts.map(() => ({ kecamatan: null, kelurahan: null, gridCell: '1:1' })) }) } as unknown as Response;
    });
    const pts = Array.from({ length: LOOKUP_CHUNK * 9 + 1 }, (_, i) => ({ lat: i / 1000, lng: 1 }));
    await expect(adapter.lookupRegions(pts, Date.now() + 60_000)).resolves.toHaveLength(pts.length);
    expect(peak).toBe(LOOKUP_PARALLEL);
    // one chunk failing fails the whole lookup
    spy.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response);
    await expect(adapter.lookupRegions(pts.slice(0, LOOKUP_CHUNK * 2), Date.now() + 60_000)).resolves.toBeNull();
    jest.restoreAllMocks();
  });
});
