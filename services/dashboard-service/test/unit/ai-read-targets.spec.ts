import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { CustomerMetricsService } from '../../src/application/ai-read/customer-metrics';
import { GallonMetricsService } from '../../src/application/ai-read/gallon-metrics';
import { MoneyMetricsService } from '../../src/application/ai-read/money-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { TARGET_METRIC_IDS, TargetMetricsService } from '../../src/application/ai-read/target-metrics';
import { AiOrgSourcesPort, DepotTargetRow } from '../../src/application/ports/ai-org-sources.port';

/*
 * HD-16: target versus actual. The base metrics are stubbed (they have their own specs); under test is what the
 * target adds: one grouped read of the targets, a depot with no target is null (never 0%), the base metric's
 * refusals and closed-month rules pass through, and the whole-month rule.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-12-09T03:00:00.000Z');
const NOVEMBER = { period: 'month', date: '2026-11-10' };
const user = { sub: 'u1', role: 'SUPER_ADMIN', depotId: null } as unknown as AuthenticatedUser;

const span = (depotId: string, from = '2026-11-01', to = '2026-11-30') => ({ depotId, legalEntityId: null, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: { depotIds: [...new Set(spans.map((s) => s.depotId))].sort(), legalEntityIds: [] },
});
const BOTH = scopeOf([span(D1), span(D2)]);
const row = (depotId: string, over: Partial<DepotTargetRow> = {}): DepotTargetRow => ({
  depotId,
  revenueTargetIdr: 0,
  ordersTarget: 0,
  newCustomersTarget: 0,
  gallonsTarget: 0,
  ...over,
});
const envelope = (value: unknown, status = 'ok', reason?: string) => ({ status, value, reason });
const DEFAULT_ROWS = [
  row(D1, { revenueTargetIdr: 1000, gallonsTarget: 2000, ordersTarget: 10, newCustomersTarget: 7 }),
  row(D2, { revenueTargetIdr: 500, gallonsTarget: 400, ordersTarget: 5, newCustomersTarget: 3 }),
];

function build(opts: { scope?: ReadScope; rows?: DepotTargetRow[] | null; actual?: unknown } = {}) {
  const actual = jest.fn(
    async (_id: string, _u: unknown, q: { split?: string }) =>
      opts.actual ?? envelope(q.split ? { total: 900, byDepot: [{ depotId: D1, value: 600 }, { depotId: D2, value: 300 }] } : 900),
  );
  const sources = {
    depotTargets: jest.fn(async (ids: readonly string[]) =>
      opts.rows === null ? null : (opts.rows ?? DEFAULT_ROWS).filter((r) => ids.includes(r.depotId)),
    ),
  };
  const scopes = { resolve: jest.fn(async () => opts.scope ?? BOTH) } as unknown as ReadScopeService;
  const base = { answer: actual };
  const service = new TargetMetricsService(
    scopes,
    base as unknown as MoneyMetricsService,
    base as unknown as GallonMetricsService,
    base as unknown as CustomerMetricsService,
    sources as unknown as AiOrgSourcesPort,
  );
  const ask = (id: string, query: Record<string, string> = NOVEMBER) => service.answer(id, user, query, NOW);
  return { actual, sources, ask };
}

describe('TargetMetricsService (HD-16)', () => {
  it('names the four monthly goals and the metric each is measured by', async () => {
    expect(TARGET_METRIC_IDS).toEqual(['T-01', 'T-02', 'T-03', 'T-04']);
    const b = build();
    for (const [id, base] of [
      ['T-01', 'P-01'],
      ['T-02', 'G-01'],
      ['T-03', 'P-04'],
      ['T-04', 'C-01'],
    ]) {
      await b.ask(id);
      expect(b.actual).toHaveBeenLastCalledWith(base, user, NOVEMBER, NOW);
    }
  });

  it('answers target, actual and pct (one decimal) from the sum of the depots targets, in ONE grouped read', async () => {
    const b = build();
    expect(await b.ask('T-01')).toMatchObject({ metricId: 'T-01', status: 'ok', unit: 'Rp', value: { target: 1500, actual: 900, pct: 60 } });
    expect(await b.ask('T-02')).toMatchObject({ unit: 'galon', value: { target: 2400, actual: 900, pct: 37.5 } });
    expect((await b.ask('T-03')).value).toEqual({ target: 15, actual: 900, pct: 6000 });
    expect((await b.ask('T-04')).value).toMatchObject({ target: 10 });
    expect(b.sources.depotTargets).toHaveBeenCalledTimes(4);
    expect(b.sources.depotTargets).toHaveBeenCalledWith([D1, D2], '2026-11');
  });

  it('with split=depot lists each depot once, null target and pct where none is set, and no total target then', async () => {
    const b = build({ rows: [row(D1, { revenueTargetIdr: 1000 }), row(D2)] });
    const out = await b.ask('T-01', { ...NOVEMBER, split: 'depot' });
    expect(out.status).toBe('ok');
    expect(out.value).toEqual({
      target: null,
      actual: 900,
      pct: null,
      byDepot: [
        { depotId: D1, target: 1000, actual: 600, pct: 60 },
        { depotId: D2, target: null, actual: 300, pct: null },
      ],
    });
    // every depot has one: the total carries it
    const all = await build().ask('T-01', { ...NOVEMBER, split: 'depot' });
    expect(all.value).toMatchObject({ target: 1500, pct: 60 });
  });

  it('is belum_ada, never 0%, when no depot has a target, and when a network answer would use a partial set', async () => {
    const none = await build({ rows: [row(D1), row(D2)] }).ask('T-01');
    expect(none).toMatchObject({ status: 'belum_ada', value: null, reason: expect.stringContaining('Belum ada target') });
    const some = await build({ rows: [row(D1, { revenueTargetIdr: 1000 }), row(D2)] }).ask('T-01');
    expect(some).toMatchObject({ status: 'belum_ada', value: null, reason: expect.stringContaining('1 dari 2 depot') });
  });

  it('a depot readable for only part of the month is not compared with a whole-month goal', async () => {
    const b = build({ scope: scopeOf([span(D1), span(D2, '2026-11-16')]) });
    expect((await b.ask('T-01')).status).toBe('belum_ada');
    const split = await b.ask('T-01', { ...NOVEMBER, split: 'depot' });
    expect(split.value).toMatchObject({ target: null, byDepot: [{ depotId: D1, pct: 60 }, { depotId: D2, target: null, pct: null }] });
  });

  it('a depot whose month is two stretches (a legal-entity change) is whole; one with a gap or a short end is not', async () => {
    const joined = build({ scope: scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D1, '2026-11-16'), span(D2)]) });
    expect(await joined.ask('T-01')).toMatchObject({ status: 'ok', value: { target: 1500 } });
    const gap = build({ scope: scopeOf([span(D1, '2026-11-01', '2026-11-14'), span(D1, '2026-11-16'), span(D2)]) });
    expect((await gap.ask('T-01')).status).toBe('belum_ada');
    const short = build({ scope: scopeOf([span(D1, '2026-11-01', '2026-11-20'), span(D2)]) });
    expect((await short.ask('T-01')).status).toBe('belum_ada');
    const overlap = build({ scope: scopeOf([span(D1, '2026-11-01', '2026-11-20'), span(D1, '2026-11-10'), span(D2)]) });
    expect((await overlap.ask('T-01')).status).toBe('ok');
  });

  it('passes the base metric refusal through word for word: a closed-month hold, a small group, a source down', async () => {
    const held = await build({ actual: envelope(null, 'ditahan', 'angka orang hanya untuk bulan ditutup') }).ask('T-04');
    expect(held).toMatchObject({ status: 'ditahan', value: null, reason: 'angka orang hanya untuk bulan ditutup' });
    const none = await build({ actual: envelope(null, 'belum_ada', 'sumber mati') }).ask('T-01');
    expect(none).toMatchObject({ status: 'belum_ada', reason: 'sumber mati' });
    expect((await build({ actual: envelope(null, 'belum_ada') }).ask('T-01')).status).toBe('belum_ada');
    expect((await build({ actual: envelope(null, 'ditahan') }).ask('T-04')).status).toBe('ditahan');
    // a held actual never reads the targets
    const b = build({ actual: envelope(null, 'ditahan', 'x') });
    await b.ask('T-04');
    expect(b.sources.depotTargets).not.toHaveBeenCalled();
  });

  it('is belum_ada when depot-service cannot answer, or when the caller may read no depot', async () => {
    expect(await build({ rows: null }).ask('T-01')).toMatchObject({ status: 'belum_ada' });
    const empty = build({ scope: scopeOf([]) });
    expect(await empty.ask('T-01')).toMatchObject({ status: 'belum_ada', value: null });
    expect(empty.actual).not.toHaveBeenCalled();
  });

  it('reads the targets of more than 100 depots in parts of 100, never one per depot', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const b = build({ scope: scopeOf(ids.map((id) => span(id))), rows: ids.map((id) => row(id, { revenueTargetIdr: 10 })) });
    const out = await b.ask('T-01');
    expect(b.sources.depotTargets).toHaveBeenCalledTimes(2);
    expect(out.value).toMatchObject({ target: 1500 });
  });

  it('only a whole calendar month, and an id outside the group is a 404', async () => {
    await expect(build().ask('T-01', { period: 'week', date: '2026-11-10' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(build().ask('T-01', { period: 'year', date: '2026-11-10' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(build().ask('T-09')).rejects.toBeInstanceOf(NotFoundException);
  });
});
