import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { VISIT_METRIC_IDS, VisitMetricsService } from '../../src/application/ai-read/visit-metrics';
import { AiVisitSourcesPort, VisitSummaryRow } from '../../src/application/ports/ai-visit-sources.port';
import { DashboardConfigService } from '../../src/config/dashboard-config.service';
import { AiVisitSourcesHttpAdapter } from '../../src/infrastructure/http/ai-visit-sources.http.adapter';

/*
 * AI-21: the visits group (V-01..V-04). The source is stubbed; under test: the formulas, the stretches each
 * depot may be read for, the point-in-time metrics ignoring the period, split, and belum_ada.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-25T03:00:00.000Z'); // 10:00 WIB, 25 Nov
const NOVEMBER = { period: 'month', date: '2026-11-10' };

const userOf = (role: string): AuthenticatedUser => ({ sub: 'u1', role, depotId: null }) as unknown as AuthenticatedUser;
const user = userOf('SUPER_ADMIN');
const span = (depotId: string, from: string, to: string, legalEntityId: string | null = PT_A) => ({ depotId, legalEntityId, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: {
    depotIds: [...new Set(spans.map((s) => s.depotId))].sort(),
    legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
  },
});
const WHOLE = scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-01', '2026-11-30', PT_B)]);
// D1 changes legal entity on 16 Nov: two stretches.
const SPLIT = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D1, '2026-11-16', '2026-11-30', PT_B), span(D2, '2026-11-01', '2026-11-30', PT_B)]);

const row = (depotId: string, o: Partial<VisitSummaryRow> = {}): VisitSummaryRow => ({
  depotId,
  completed: 2,
  findings: 1,
  lastCompletedOn: '2026-11-20',
  followUpsOpen: 3,
  followUpsOverdue: 1,
  ...o,
});

function build(scope: ReadScope = WHOLE, summary?: jest.Mock) {
  const sources = { summary: summary ?? jest.fn(async (ids: readonly string[]) => ids.map((d) => row(d))) };
  const scopes = { resolve: jest.fn(async () => scope) } as unknown as ReadScopeService;
  const service = new VisitMetricsService(scopes, sources as unknown as AiVisitSourcesPort);
  const ask = (id: string, query: Record<string, string> = NOVEMBER, now: Date = NOW) => service.answer(id, user, query, now);
  return { sources, scopes, service, ask };
}

describe('VisitMetricsService', () => {
  it('lists its four metrics and refuses an id outside the group', async () => {
    expect(VISIT_METRIC_IDS).toEqual(['V-01', 'V-02', 'V-03', 'V-04']);
    await expect(build().ask('V-09')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build().ask('toString')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('holds visits back from roles that may not read them, and answers the ones that may', async () => {
    for (const role of ['FINANCE', 'HR', 'MARKETING', 'STAFF_DEPOT']) {
      const b = build();
      const out = await b.service.answer('V-01', userOf(role), NOVEMBER, NOW);
      expect(out).toMatchObject({ status: 'ditahan', value: null });
      expect(out.reason).toContain('kunjungan');
      expect(b.sources.summary).not.toHaveBeenCalled();
    }
    for (const role of ['KEPALA_DEPOT', 'SUPERVISOR']) {
      expect(await build().service.answer('V-01', userOf(role), NOVEMBER, NOW)).toMatchObject({ status: 'ok' });
    }
  });

  it('V-01 / V-04: adds the counts over every stretch, per depot with split, asking in WIB instants', async () => {
    const b = build(SPLIT);
    const v1 = await b.ask('V-01');
    expect(v1).toMatchObject({ status: 'ok', unit: 'kunjungan', value: 6 }); // D1 twice + D2, 2 each
    const asked = b.sources.summary.mock.calls.map((c) => `${c[0].join(',')}@${c[1].from}..${c[1].to}`).sort();
    expect(asked).toEqual(
      [
        `${D1}@2026-10-31T17:00:00.000Z..2026-11-15T17:00:00.000Z`,
        `${D1}@2026-11-15T17:00:00.000Z..2026-11-30T17:00:00.000Z`,
        `${D2}@2026-10-31T17:00:00.000Z..2026-11-30T17:00:00.000Z`,
      ].sort(),
    );
    const split = await b.ask('V-04', { ...NOVEMBER, split: 'depot' });
    expect(split.value).toEqual({
      total: 3,
      byDepot: [
        { depotId: D1, value: 2 },
        { depotId: D2, value: 1 },
      ],
    });
  });

  it('V-02: days since the last completed visit per depot, null for never, only with split', async () => {
    const summary = jest.fn(async (ids: readonly string[]) => ids.map((d) => row(d, d === D1 ? { lastCompletedOn: '2026-11-20' } : { lastCompletedOn: null })));
    const b = build(WHOLE, summary);
    const none = await b.ask('V-02');
    expect(none).toMatchObject({ status: 'belum_ada', value: null });
    expect(none.reason).toContain('split=depot');
    const out = await b.ask('V-02', { split: 'depot', period: 'month', date: '2026-10-10' }, NOW);
    expect(out.value).toEqual({
      byDepot: [
        { depotId: D1, days: 5 },
        { depotId: D2, days: null },
      ],
    });
    expect(out.period).toMatchObject({ from: '2026-11-25', to: '2026-11-25' }); // the period asked does not move it
  });

  it('V-02 never goes below 0, V-03 gives open and overdue (split adds each depot)', async () => {
    const b = build(WHOLE, jest.fn(async (ids: readonly string[]) => ids.map((d) => row(d, { lastCompletedOn: '2026-11-26' }))));
    expect((await b.ask('V-02', { split: 'depot' })).value).toEqual({
      byDepot: [
        { depotId: D1, days: 0 },
        { depotId: D2, days: 0 },
      ],
    });
    const c = build();
    expect((await c.ask('V-03')).value).toEqual({ open: 6, overdue: 2 });
    expect((await c.ask('V-03', { split: 'depot' })).value).toEqual({
      open: 6,
      overdue: 2,
      byDepot: [
        { depotId: D1, open: 3, overdue: 1 },
        { depotId: D2, open: 3, overdue: 1 },
      ],
    });
  });

  it('answers belum_ada when no depot is readable today, nothing is in scope, or the source is down', async () => {
    const ended = scopeOf([span(D1, '2026-11-01', '2026-11-15')]);
    expect((await build(ended).ask('V-03')).reason).toContain('hari ini');
    expect((await build(ended).ask('V-02', { split: 'depot' })).reason).toContain('hari ini');
    expect((await build(scopeOf([])).ask('V-01')).status).toBe('belum_ada');
    const down = jest.fn(async () => null);
    for (const [id, q] of [
      ['V-01', NOVEMBER],
      ['V-04', NOVEMBER],
      ['V-02', { split: 'depot' }],
      ['V-03', {}],
    ] as const) {
      expect(await build(WHOLE, down).ask(id, { ...q })).toMatchObject({ status: 'belum_ada', value: null });
    }
  });

  it('reads at most 100 depots a call', async () => {
    const many = scopeOf(Array.from({ length: 101 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-11-01', '2026-11-30')));
    const b = build(many);
    expect((await b.ask('V-01')).value).toBe(202);
    expect(b.sources.summary.mock.calls.map((c) => c[0].length)).toEqual([100, 1]);
  });

  it('still refuses a nonsense period on a point-in-time metric', async () => {
    await expect(build().ask('V-03', { period: 'fortnight' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AiVisitSourcesHttpAdapter', () => {
  const RANGE = { from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' };
  const adapter = () => new AiVisitSourcesHttpAdapter({ depotServiceUrl: 'http://depot.test', internalServiceKey: 'k' } as unknown as DashboardConfigService);
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

  it('asks depot-service with the internal key and copies out only the known fields', async () => {
    const calls = answer({ items: [{ ...row(D1), visitorId: 'secret' }, row(D2, { lastCompletedOn: null })] });
    await expect(adapter().summary([D1, D2], RANGE)).resolves.toEqual([row(D1), row(D2, { lastCompletedOn: null })]);
    expect(calls[0].url.pathname).toBe('/api/v1/visits/internal/ai-summary');
    expect(calls[0].url.searchParams.get('depotIds')).toBe(`${D1},${D2}`);
    expect(calls[0].url.searchParams.get('to')).toBe(RANGE.to);
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it.each([
    ['a failed call', { items: [row(D1)] }, false],
    ['an unreachable service', 'throw', true],
    ['an empty body', null, true],
    ['an answer without the list', {}, true],
    ['a short list', { items: [] }, true],
    ['a depot nobody asked about', { items: [row(D2)] }, true],
    ['a row that is not an object', { items: [null] }, true],
    ['a fraction count', { items: [row(D1, { completed: 1.5 })] }, true],
    ['a negative count', { items: [row(D1, { followUpsOpen: -1 })] }, true],
    ['a missing count', { items: [{ ...row(D1), findings: undefined }] }, true],
    ['an overdue count that is text', { items: [{ ...row(D1), followUpsOverdue: '1' }] }, true],
    ['a last visit that is not a day', { items: [row(D1, { lastCompletedOn: 'yesterday' })] }, true],
    ['a last visit left out', { items: [{ ...row(D1), lastCompletedOn: undefined }] }, true],
  ])('is null for %s', async (_name, body, ok) => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    answer(body, ok);
    await expect(adapter().summary([D1], RANGE)).resolves.toBeNull();
  });

  it('is null for a depot answered twice', async () => {
    answer({ items: [row(D1), row(D1)] });
    await expect(adapter().summary([D1, D2], RANGE)).resolves.toBeNull();
  });
});
