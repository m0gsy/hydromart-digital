import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { CUSTOMER_METRIC_IDS, CUSTOMER_METRICS, CustomerMetricsService } from '../../src/application/ai-read/customer-metrics';
import { DELIVERY_METRIC_IDS, DELIVERY_METRICS, DeliveryMetricsService } from '../../src/application/ai-read/delivery-metrics';
import { GALLON_METRIC_IDS, GALLON_METRICS, GallonMetricsService } from '../../src/application/ai-read/gallon-metrics';
import { assertNoPersonalData } from '../../src/application/ai-read/masking';
import { CumulativeScopeService } from '../../src/application/ai-read/cumulative-scope.service';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { DeliverySummary, GallonLedgerRow } from '../../src/application/ports/ai-customer-sources.port';

/*
 * HD-6 H3: the customer, delivery and gallon metrics. The sources are stubbed; what is under test is
 * what a metric does with them: the spans of days a depot may be read for, the WIB instants asked
 * for, masking of small groups (a 1-person cell, a differencing attempt), and when it says
 * belum_ada or ditahan instead of a number.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-25T03:00:00.000Z'); // 10:00 WIB 25 Nov: November is still running
const CLOSED = new Date('2026-12-08T03:00:00.000Z'); // November is closed and settled (8 Dec)
const NOVEMBER = { period: 'month', date: '2026-11-10' };
const OCTOBER = { period: 'month', date: '2026-10-10' };
const NOV_FROM = '2026-10-31T17:00:00.000Z';
const NOV_TO = '2026-11-30T17:00:00.000Z';
const user = { sub: 'u1', role: 'SUPER_ADMIN', depotId: null } as unknown as AuthenticatedUser;

const span = (depotId: string, from: string, to: string, legalEntityId: string | null = PT_A) => ({ depotId, legalEntityId, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: {
    depotIds: [...new Set(spans.map((s) => s.depotId))].sort(),
    legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
  },
});
const BOTH = scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-01', '2026-11-30', PT_B)]);
const ONE = scopeOf([span(D1, '2026-11-01', '2026-11-30')]);
const NONE = scopeOf([]);
const OCT = scopeOf([span(D1, '2026-10-01', '2026-10-31'), span(D2, '2026-10-01', '2026-10-31', PT_B)]);
const DAY10 = scopeOf([span(D1, '2026-11-10', '2026-11-10'), span(D2, '2026-11-10', '2026-11-10', PT_B)]);
const scopes = (scope: ReadScope) => ({ resolve: jest.fn(async () => scope) }) as unknown as ReadScopeService;
/** The cumulative-history check: every depot readable, except those named in `held` (depot -> the day it became readable). */
const cumulative = (held: Record<string, string | null> = {}) =>
  ({
    split: jest.fn(async (_user: unknown, ids: string[]) => ({
      readable: ids.filter((i) => !(i in held)),
      heldBack: ids.filter((i) => i in held).map((depotId) => ({ depotId, since: held[depotId] })),
    })),
  }) as unknown as CumulativeScopeService;

const window = (o: Partial<{ active: number; newCustomers: number; repeat: number; newAtDepot: { depotId: string; customers: number }[] }> = {}) => ({
  active: 40,
  newCustomers: 12,
  repeat: 25,
  newAtDepot: [{ depotId: D1, customers: 9 }],
  ...o,
});

describe('customer metrics (C-)', () => {
  const make = (scope: ReadScope = BOTH, over: Record<string, unknown> = {}, held: Record<string, string | null> = {}) => {
    const sources = {
      customerWindow: jest.fn(async () => window()),
      cohorts: jest.fn(async () => [
        { cohort: '2026-09', monthIndex: 0, customers: 20 },
        { cohort: '2026-09', monthIndex: 1, customers: 8 },
        { cohort: '2026-09', monthIndex: 2, customers: 12 },
        { cohort: '2026-10', monthIndex: 0, customers: 2 },
        { cohort: '2026-10', monthIndex: 1, customers: 1 },
      ]),
      ratings: jest.fn(async () => ({ reviews: 10, ratingSum: 43, reviewers: 6 })),
      segments: jest.fn(async () => ({ active: 30, atRisk: 12, inactive: 50 })),
      ...over,
    };
    return { sources, service: new CustomerMetricsService(scopes(scope), cumulative(held), sources as never) };
  };
  // the default answers a CLOSED month; askOpen answers while November is still running (held, never rounded)
  const ask = (s: CustomerMetricsService, id: string, q: Record<string, string> = NOVEMBER) => s.answer(id, user, q, CLOSED);
  const askOpen = (s: CustomerMetricsService, id: string, q: Record<string, string> = NOVEMBER) => s.answer(id, user, q, NOW);

  it('echoes every metric of the dictionary, with a unit and whole-month rule', () => {
    expect(CUSTOMER_METRIC_IDS).toEqual(['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10']);
    for (const id of CUSTOMER_METRIC_IDS) expect(CUSTOMER_METRICS[id].unit.length).toBeGreaterThan(0);
  });

  it('C-01 answers the new customers of the month, asking in WIB instants for exactly the granted days', async () => {
    const { service, sources } = make();
    const a = await ask(service, 'C-01');
    expect(a).toMatchObject({ metricId: 'C-01', status: 'ok', value: 12, unit: 'orang' });
    expect(sources.customerWindow).toHaveBeenCalledWith(
      [
        { depotId: D1, from: NOV_FROM, to: NOV_TO },
        { depotId: D2, from: NOV_FROM, to: NOV_TO },
      ],
      NOV_FROM,
    );
  });

  it('a depot that changed legal entity mid-month is read only for the days the role may read it', async () => {
    // D1 belonged to an entity the role may not read until 16 Nov 00:00 WIB
    const { service, sources } = make(scopeOf([span(D1, '2026-11-16', '2026-11-30', PT_B)]));
    await ask(service, 'C-04');
    expect(sources.customerWindow).toHaveBeenCalledWith([{ depotId: D1, from: '2026-11-15T17:00:00.000Z', to: NOV_TO }], NOV_FROM);
  });

  it('a group of 1 or 2 people is held back, never shown and never turned into 0; zero is a real answer', async () => {
    for (const n of [1, 2]) {
      const { service } = make(BOTH, { customerWindow: jest.fn(async () => window({ newCustomers: n, active: n })) });
      const a = await ask(service, 'C-01');
      expect(a).toMatchObject({ status: 'ditahan', value: null });
      expect(a.reason).toContain('kurang dari 3');
    }
    const three = make(BOTH, { customerWindow: jest.fn(async () => window({ newCustomers: 3 })) });
    expect(await ask(three.service, 'C-01')).toMatchObject({ status: 'ok', value: 3 });
    const zero = make(BOTH, { customerWindow: jest.fn(async () => window({ newCustomers: 0 })) });
    expect(await ask(zero.service, 'C-01')).toMatchObject({ status: 'ok', value: 0 });
  });

  it('C-04 counts distinct active customers; C-02 only for one depot, never summed across depots', async () => {
    const { service } = make();
    expect(await ask(service, 'C-04')).toMatchObject({ status: 'ok', value: 40 });
    expect(await ask(service, 'C-02')).toMatchObject({ status: 'ditahan', value: null });
    const one = make(ONE);
    expect(await ask(one.service, 'C-02')).toMatchObject({ status: 'ok', value: 9 });
    const absent = make(ONE, { customerWindow: jest.fn(async () => window({ newAtDepot: [] })) });
    expect(await ask(absent.service, 'C-02')).toMatchObject({ status: 'ok', value: 0 });
    const small = make(ONE, { customerWindow: jest.fn(async () => window({ newAtDepot: [{ depotId: D1, customers: 2 }] })) });
    expect(await ask(small.service, 'C-02')).toMatchObject({ status: 'ditahan' });
  });

  it('C-05 gives the repeat and first-time cells and the rate; a small cell holds the rate and its neighbour back', async () => {
    const { service } = make();
    const a = await ask(service, 'C-05');
    expect(a.status).toBe('ok');
    expect(a.value).toMatchObject({ total: 40, ratePct: 62.5 });
    expect((a.value as { cells: unknown[] }).cells).toEqual([
      { key: 'berulang', value: 25 },
      { key: 'pertama kali pada bulan ini', value: 15 },
    ]);
    // 2 repeaters out of 20: the 2 is held back, and 18 first-timers would give it away by subtraction from the total,
    // so it is held too; the rate (10%) would reveal it as well, so it is not given.
    const diff = make(BOTH, { customerWindow: jest.fn(async () => window({ active: 20, repeat: 2 })) });
    // (the whole answer is held: nothing is left to publish that is not the 2, the 18 or the 10%)
    expect(await ask(diff.service, 'C-05')).toMatchObject({ status: 'ditahan', value: null });
    // 0 repeaters and 2 first-timers: the 0 names nobody and stays, the 2 is held, and no total or rate is given
    const lone = make(BOTH, { customerWindow: jest.fn(async () => window({ active: 2, repeat: 0 })) });
    const lv = (await ask(lone.service, 'C-05')).value as { cells: { value: number | null }[]; total: number | null; ratePct: number | null };
    expect(lv.cells.map((x) => x.value)).toEqual([0, null]);
    expect(lv.total).toBeNull();
    expect(lv.ratePct).toBeNull();
    // everything small: held as a whole
    const tiny = make(BOTH, { customerWindow: jest.fn(async () => window({ active: 2, repeat: 1 })) });
    expect(await ask(tiny.service, 'C-05')).toMatchObject({ status: 'ditahan' });
    // no buyers at all: nothing to say
    const none = make(BOTH, { customerWindow: jest.fn(async () => window({ active: 0, repeat: 0, newCustomers: 0 })) });
    expect(await ask(none.service, 'C-05')).toMatchObject({ status: 'belum_ada' });
  });

  it('C-06 is as of the last day of a CLOSED month, in multiples of 5, and masks small segments', async () => {
    const { service, sources } = make();
    const a = await ask(service, 'C-06');
    expect(a.status).toBe('ok');
    // closed month: as of 30 Nov; 30 days back is 31 Oct, 60 days back is 1 Oct, the limit is 1 Dec 00:00 WIB
    expect(sources.segments).toHaveBeenCalledWith([D1, D2], {
      activeSince: '2026-10-30T17:00:00.000Z',
      riskSince: '2026-09-30T17:00:00.000Z',
      until: '2026-11-30T17:00:00.000Z',
    });
    const v = a.value as { asOf: string; cells: { key: string; value: number }[]; total: number };
    expect(v.asOf).toBe('2026-11-30');
    // 30, 12, 50 (92): published as 30, 10, 50 (90)
    expect(v.cells.map((x) => x.value)).toEqual([30, 10, 50]);
    expect(v.total).toBe(90);
    expect(a.label).toContain('kelipatan 5');
    // the overlap with C-04's calendar month is said, not hidden
    expect(a.label).toContain('C-04');
    // mid-month there is no closed as-of date: refused with the reason, nothing is read
    const open = make();
    const refused = await askOpen(open.service, 'C-06');
    expect(refused).toMatchObject({ status: 'belum_ada', value: null });
    expect(refused.reason).toContain('hari terakhir bulan yang sudah ditutup');
    expect(open.sources.segments).not.toHaveBeenCalled();
    const past = make(OCT);
    await ask(past.service, 'C-06', OCTOBER);
    expect(past.sources.segments).toHaveBeenCalledWith([D1, D2], expect.objectContaining({ until: '2026-10-31T17:00:00.000Z' }));
    // 2 at-risk people: held, and the smallest neighbour with them so the total cannot give them away
    const small = make(BOTH, { segments: jest.fn(async () => ({ active: 30, atRisk: 2, inactive: 50 })) });
    const sv = (await ask(small.service, 'C-06')).value as { cells: { key: string; value: number | null; flag?: string }[]; total: number | null };
    expect(sv.cells.find((c) => c.key === 'berisiko')).toEqual({ key: 'berisiko', value: null, flag: 'kurang dari 3' });
    expect(sv.cells.find((c) => c.key === 'aktif')).toMatchObject({ value: null, flag: 'ditahan' });
    expect(sv.cells.find((c) => c.key === 'tidak aktif')).toMatchObject({ value: 50 });
    const only = make(BOTH, { segments: jest.fn(async () => ({ active: 1, atRisk: 2, inactive: 0 })) });
    expect(await ask(only.service, 'C-06')).toMatchObject({ status: 'ditahan' });
    const empty = make(BOTH, { segments: jest.fn(async () => ({ active: 0, atRisk: 0, inactive: 0 })) });
    expect(await ask(empty.service, 'C-06')).toMatchObject({ status: 'belum_ada' });
  });

  it('C-06 puts the day boundaries at 30/31 and 60/61 days since the last order, in WIB', async () => {
    const { service, sources } = make();
    await ask(service, 'C-06');
    const at = (sources.segments as jest.Mock).mock.calls[0][1] as { activeSince: string; riskSince: string; until: string };
    // asOf is 30 Nov. 30 days back = 31 Oct: an order any time on 31 Oct (WIB) is exactly 30 days old = active.
    expect(at.activeSince).toBe('2026-10-30T17:00:00.000Z');
    expect(new Date(at.activeSince).getTime() - 1).toBeLessThan(new Date(at.activeSince).getTime());
    // 60 days back = 1 Oct: an order on 1 Oct is 60 days old = at risk; on 30 Sep it is 61 = inactive.
    expect(at.riskSince).toBe('2026-09-30T17:00:00.000Z');
    // and nothing after the end of 30 Nov is counted
    expect(at.until).toBe('2026-11-30T17:00:00.000Z');
  });

  it('C-06 reads the depots readable on the last day only', async () => {
    const late = make(scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-01', '2026-11-25')]));
    await ask(late.service, 'C-06');
    expect(late.sources.segments).toHaveBeenCalledWith([D1], expect.anything());
    const gone = make(scopeOf([span(D2, '2026-11-01', '2026-11-25')]));
    expect(await ask(gone.service, 'C-06')).toMatchObject({ status: 'belum_ada' });
  });

  it('C-06 and the cumulative metrics hold back a depot whose older history the role may not read, and say since when', async () => {
    const { service, sources } = make(BOTH, {}, { [D2]: '2026-11-10' });
    const a = await ask(service, 'C-06');
    expect(sources.segments).toHaveBeenCalledWith([D1], expect.anything());
    expect((a.value as { heldBackDepots: number }).heldBackDepots).toBe(1);
    expect(a.label).toContain('1 depot ditahan');
    expect(a.label).toContain('2026-11-10');
    const all = make(BOTH, {}, { [D1]: '2026-11-10', [D2]: null });
    const h = await ask(all.service, 'C-06');
    expect(h).toMatchObject({ status: 'ditahan', value: null });
    expect(all.sources.segments).not.toHaveBeenCalled();
  });

  it('a month closed 7 days ago is still held, and from the 8th it is answered (late cancellations settle first)', async () => {
    const day = (d: string) => new Date(`2026-12-${d}T03:00:00.000Z`);
    for (const id of ['C-01', 'C-04', 'C-05', 'C-06', 'C-10']) {
      const early = make();
      const held = await early.service.answer(id, user, NOVEMBER, day('07'));
      expect(held).toMatchObject({ status: id === 'C-06' ? 'belum_ada' : 'ditahan', value: null });
      expect(held.reason).toContain('mulai tanggal 8 bulan berikutnya');
      const settled = await make().service.answer(id, user, NOVEMBER, day('08'));
      expect(settled.status).toBe('ok');
    }
  });

  it('a running month is never answered: held for every metric that counts people, and nothing is read', async () => {
    const { service, sources } = make();
    for (const id of ['C-01', 'C-02', 'C-04', 'C-05', 'C-10']) {
      const a = await askOpen(service, id);
      expect(a).toMatchObject({ status: 'ditahan', value: null });
      expect(a.reason).toContain('mulai tanggal 8 bulan berikutnya');
    }
    expect(await askOpen(service, 'C-08', { from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ status: 'ditahan', value: null });
    expect(sources.customerWindow).not.toHaveBeenCalled();
    expect(sources.ratings).not.toHaveBeenCalled();
    expect(sources.cohorts).not.toHaveBeenCalled();
    // the same month once it has closed is exact, and a count under 3 is still held
    const w = { active: 43, newCustomers: 12, repeat: 27, newAtDepot: [] };
    const closed = make(BOTH, { customerWindow: jest.fn(async () => w) });
    expect(await ask(closed.service, 'C-01')).toMatchObject({ status: 'ok', value: 12 });
    expect(await ask(closed.service, 'C-04')).toMatchObject({ value: 43 });
    expect((await ask(closed.service, 'C-05')).value).toMatchObject({ total: 43, ratePct: 62.8 });
    const two = make(BOTH, { customerWindow: jest.fn(async () => ({ ...w, newCustomers: 2 })) });
    expect(await ask(two.service, 'C-01')).toMatchObject({ status: 'ditahan', value: null });
  });

  it('differencing: a total as of two dates, or a running month on two days, never isolates 1 or 2 people', async () => {
    // C-06 total of October (100) and of November (101..104): the new-customer group C-01/C-02 held back is 2,
    // and 102 - 100 would give it away. Both totals are published in multiples of 5, so every difference is 0 or 5.
    const totals: number[] = [];
    for (const [n, month, scope] of [[100, OCTOBER, OCT], [102, NOVEMBER, BOTH]] as const) {
      const { service } = make(scope, { segments: jest.fn(async () => ({ active: n - 40, atRisk: 20, inactive: 20 })) });
      totals.push(((await ask(service, 'C-06', month)).value as { total: number }).total);
    }
    expect(totals.every((t) => t % 5 === 0)).toBe(true);
    expect(Math.abs(totals[1] - totals[0])).not.toBe(2);
    // a running month watched on day X (41 new customers) and day X+1 (42): neither day is answered at all
    const day1 = make(BOTH, { customerWindow: jest.fn(async () => window({ newCustomers: 41, active: 60 })) });
    expect(await askOpen(day1.service, 'C-01')).toMatchObject({ status: 'ditahan', value: null });
    expect(day1.sources.customerWindow).not.toHaveBeenCalled();
  });

  it('C-08 holds a cohort back WHOLE when any cell of it is under 3, or when 1 or 2 did not come back', async () => {
    const cells = [
      { cohort: '2026-08', monthIndex: 0, customers: 20 },
      { cohort: '2026-08', monthIndex: 1, customers: 8 },
      { cohort: '2026-08', monthIndex: 2, customers: 12 },
      { cohort: '2026-09', monthIndex: 0, customers: 20 },
      { cohort: '2026-09', monthIndex: 1, customers: 8 },
      { cohort: '2026-09', monthIndex: 2, customers: 2 },
      { cohort: '2026-10', monthIndex: 0, customers: 20 },
      { cohort: '2026-10', monthIndex: 1, customers: 19 },
      { cohort: '2026-11', monthIndex: 0, customers: 2 },
    ];
    const { service } = make(BOTH, { cohorts: jest.fn(async () => cells) });
    const a = await ask(service, 'C-08', { from: '2026-08-01', to: '2026-11-30' });
    expect(a.status).toBe('ok');
    const rows = (a.value as { cohorts: { cohort: string; size: number | null; flag?: string; months: { monthIndex: number; customers: number; ratePct: number }[] }[] }).cohorts;
    // sizes and cells are ALWAYS multiples of 5, closed month or not: 8 -> 10, 12 -> 10, rates from the rounded numbers
    expect(rows[0]).toEqual({ cohort: '2026-08', size: 20, months: [{ monthIndex: 1, customers: 10, ratePct: 50 }, { monthIndex: 2, customers: 10, ratePct: 50 }] });
    // a cell of 2 people, 19 of 20 returning (1 who did not), and a cohort of 2: all held whole, with the same flag as everywhere
    for (const held of rows.slice(1)) expect(held).toEqual({ cohort: held.cohort, size: null, flag: 'kurang dari 3', months: [] });
    const allSmall = make(BOTH, { cohorts: jest.fn(async () => [{ cohort: '2026-10', monthIndex: 0, customers: 1 }]) });
    expect(await ask(allSmall.service, 'C-08', { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ status: 'ditahan' });
    const empty = make(BOTH, { cohorts: jest.fn(async () => []) });
    expect(await ask(empty.service, 'C-08', { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ status: 'belum_ada' });
    // a cohort row without a month-0 cell is not a cohort of anyone
    const odd = make(BOTH, { cohorts: jest.fn(async () => [{ cohort: '2026-10', monthIndex: 1, customers: 5 }]) });
    expect(await ask(odd.service, 'C-08', { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ status: 'ditahan' });
    // a held row beside a published one: the exact repeat/active of C-05 minus an exact diagonal must not give the held row away
    const mix = make(BOTH, {
      cohorts: jest.fn(async () => [
        { cohort: '2026-09', monthIndex: 0, customers: 22 },
        { cohort: '2026-09', monthIndex: 1, customers: 13 },
        { cohort: '2026-10', monthIndex: 0, customers: 21 },
        { cohort: '2026-10', monthIndex: 1, customers: 2 },
      ]),
    });
    const m = (await ask(mix.service, 'C-08', { from: '2026-09-01', to: '2026-10-31' })).value as { cohorts: { cohort: string; size: number | null; months: { customers: number | null; ratePct: number | null }[] }[] };
    expect(m.cohorts[0]).toEqual({ cohort: '2026-09', size: 20, months: [{ monthIndex: 1, customers: 15, ratePct: 75 }] });
    expect(m.cohorts[1]).toMatchObject({ cohort: '2026-10', size: null, flag: 'kurang dari 3' });
    for (const n of [m.cohorts[0].size as number, ...m.cohorts[0].months.map((x) => x.customers as number)]) expect(n % 5).toBe(0);
    // a range that reaches today is refused whole
    const run = make(BOTH, { cohorts: jest.fn(async () => [{ cohort: '2026-11', monthIndex: 0, customers: 22 }]) });
    expect(await askOpen(run.service, 'C-08', { from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ status: 'ditahan', value: null });
  });

  it('C-10 is the mean stars of all reviews, held back unless 3 different customers wrote them', async () => {
    const { service } = make();
    expect(await ask(service, 'C-10')).toMatchObject({ status: 'ok', value: { averageStars: 4.3, reviews: 10 } });
    const two = make(BOTH, { ratings: jest.fn(async () => ({ reviews: 9, ratingSum: 41, reviewers: 2 })) });
    expect(await ask(two.service, 'C-10')).toMatchObject({ status: 'ditahan', value: null });
    const none = make(BOTH, { ratings: jest.fn(async () => ({ reviews: 0, ratingSum: 0, reviewers: 0 })) });
    expect(await ask(none.service, 'C-10')).toMatchObject({ status: 'belum_ada' });
  });

  it('C-03, C-07 and C-09 are never answered with a number', async () => {
    const { service } = make();
    expect(await ask(service, 'C-03')).toMatchObject({ status: 'belum_ada', value: null });
    expect(await ask(service, 'C-07')).toMatchObject({ status: 'ditahan', value: null });
    expect(await ask(service, 'C-09')).toMatchObject({ status: 'ditahan', value: null });
  });

  it('fails closed: a source that cannot answer, no readable depot, or too many depots is belum_ada, never 0', async () => {
    const down = make(BOTH, {
      customerWindow: jest.fn(async () => null),
      cohorts: jest.fn(async () => null),
      ratings: jest.fn(async () => null),
      segments: jest.fn(async () => null),
    });
    for (const id of ['C-01', 'C-02', 'C-04', 'C-05', 'C-06', 'C-08', 'C-10']) {
      expect(await ask(down.service, id, id === 'C-08' ? { from: '2026-10-01', to: '2026-10-31' } : NOVEMBER)).toMatchObject({ status: 'belum_ada', value: null });
    }
    const empty = make(NONE);
    expect(await ask(empty.service, 'C-01')).toMatchObject({ status: 'belum_ada' });
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const wide = make(scopeOf(many.map((d) => span(d, '2026-11-01', '2026-11-30'))));
    for (const id of ['C-01', 'C-06', 'C-08', 'C-10']) {
      expect(await ask(wide.service, id, id === 'C-08' ? { from: '2026-11-01', to: '2026-11-30' } : NOVEMBER)).toMatchObject({ status: 'belum_ada' });
    }
    expect(wide.sources.customerWindow).not.toHaveBeenCalled();
    // a depot with many entity changes can pass 200 spans without passing 100 depots
    const spans = Array.from({ length: 201 }, (_, i) => span(D1, `2026-11-01`, `2026-11-30`, `entity-${i}`));
    expect(await ask(make(scopeOf(spans)).service, 'C-04')).toMatchObject({ status: 'belum_ada' });
  });

  it('refuses a period that is not one whole month (400) and an id outside the group (404)', async () => {
    const { service } = make();
    await expect(ask(service, 'C-01', { period: 'week', date: '2026-11-10' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ask(service, 'C-01', { period: 'day', date: '2026-11-10' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ask(service, 'C-01', { from: '2026-10-01', to: '2026-11-30' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ask(service, 'C-01', { from: '2026-11-05', to: '2026-11-30' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ask(service, 'P-01')).rejects.toBeInstanceOf(NotFoundException);
    await expect(ask(service, 'toString')).rejects.toBeInstanceOf(NotFoundException);
    await expect(ask(service, 'C-01', { period: 'year', date: '2026-11-10' })).rejects.toBeInstanceOf(BadRequestException);
    // C-08 may run over several whole months, or a year
    await expect(ask(service, 'C-08', { period: 'year', date: '2025-11-10' })).resolves.toMatchObject({ status: 'ok' });
    await expect(ask(service, 'C-08', { period: 'week', date: '2026-11-10' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ask(service, 'C-08', { from: '2026-09-01', to: '2026-11-30' })).resolves.toMatchObject({ status: 'ok' });
    await expect(ask(service, 'C-08', { from: '2026-09-05', to: '2026-11-30' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never carries a name, phone or address: the answer passes the personal-data guard for every metric', async () => {
    const { service } = make();
    for (const id of CUSTOMER_METRIC_IDS) {
      const a = await ask(service, id, id === 'C-08' ? { from: '2026-09-01', to: '2026-11-30' } : NOVEMBER);
      expect(() => assertNoPersonalData(a)).not.toThrow();
    }
  });
});

const delivered = (o: Partial<DeliverySummary> = {}): DeliverySummary => ({
  delivered: 40,
  onTime: 34,
  storedVerdicts: 30,
  thresholdMinutes: 90,
  medianMinutes: 41.5,
  couriers: 5,
  failed: 6,
  noShow: 2,
  otherFailed: 4,
  rescheduled: 3,
  ...o,
});

describe('delivery metrics (K-)', () => {
  const LIVE = [
    { status: 'CREATED', count: 3 },
    { status: 'CONFIRMED', count: 4 },
    { status: 'PREPARING', count: 5 },
    { status: 'DRIVER_ASSIGNED', count: 3 },
    { status: 'PICKED_UP', count: 6 },
    { status: 'ON_DELIVERY', count: 7 },
  ];
  const make = (scope: ReadScope = BOTH, over: Record<string, unknown> = {}, held: Record<string, string | null> = {}) => {
    const sources = {
      deliverySummary: jest.fn(async () => delivered()),
      cancelledBeforeDeparture: jest.fn(async () => 4),
      liveOrders: jest.fn(async () => LIVE),
      ...over,
    };
    return { sources, scope: scopes(scope), service: new DeliveryMetricsService(scopes(scope), cumulative(held), sources as never) };
  };
  // K-07 is as of today (25 Nov); K-01 to K-05 are answered for a CLOSED month only
  const ask = (s: DeliveryMetricsService, id: string, q: Record<string, string> = NOVEMBER) => s.answer(id, user, q, id === 'K-07' ? NOW : CLOSED);
  const askOpen = (s: DeliveryMetricsService, id: string, q: Record<string, string> = NOVEMBER) => s.answer(id, user, q, NOW);

  it('lists the dictionary and answers K-01 to K-04 from one summary over the granted spans', async () => {
    expect(DELIVERY_METRIC_IDS).toEqual(['K-01', 'K-02', 'K-03', 'K-04', 'K-05', 'K-06', 'K-07']);
    expect(DELIVERY_METRICS['K-05']).toMatchObject({ oneMonth: true });
    const { service, sources } = make(scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D2, '2026-11-01', '2026-11-30', PT_B)]));
    expect(await ask(service, 'K-01')).toMatchObject({ status: 'ok', value: 40 });
    expect(sources.deliverySummary).toHaveBeenCalledWith([
      { depotId: D1, from: NOV_FROM, to: '2026-11-15T17:00:00.000Z' },
      { depotId: D2, from: NOV_FROM, to: NOV_TO },
    ]);
    const k2 = await ask(service, 'K-02');
    expect(k2.value).toEqual({ ratePct: 85, onTime: 34, delivered: 40 });
    // the label says which numbers are the stored verdict and which were graded again, and with what
    expect(k2.label).toContain('30 dari 40');
    expect(k2.label).toContain('10 yang selesai sebelum status disimpan');
    expect(k2.label).toContain('90 menit');
    expect(await ask(service, 'K-03')).toMatchObject({ status: 'ok', value: 41.5, unit: 'menit' });
    expect(k2.label).toContain('/hq/sla-policy');
    const many = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ failed: 12, noShow: 5, otherFailed: 7 })) });
    const k4 = await ask(many.service, 'K-04');
    expect(k4.value).toEqual({ failed: 12, noShow: 5, otherReason: 7, rescheduled: 3, cancelledBeforeDeparture: 4, held: {} });
    expect(k4.label).toContain('teks bebas');
    expect(k4.label).toContain('sebelum kurir berangkat');
    expect(many.sources.cancelledBeforeDeparture).toHaveBeenCalledWith([
      { depotId: D1, from: NOV_FROM, to: NOV_TO },
      { depotId: D2, from: NOV_FROM, to: NOV_TO },
    ]);
  });

  it('K-04 holds a count of 1 or 2 back (and the neighbour that would give it away), and says belum_ada if cancellations cannot be read', async () => {
    const small = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ failed: 8, noShow: 2, otherFailed: 6 })), cancelledBeforeDeparture: jest.fn(async () => 1) });
    const a = await ask(small.service, 'K-04');
    const v = a.value as { noShow: number | null; otherReason: number | null; failed: number | null; rescheduled: number | null; cancelledBeforeDeparture: number | null; held: Record<string, string> };
    expect(v.noShow).toBeNull();
    expect(v.held.noShow).toBe('kurang dari 3');
    // 8 failed with 2 held: the 6 beside it is held too, or 8 - 6 would give the 2 back
    expect(v.otherReason).toBeNull();
    expect(v.held.otherReason).toBe('ditahan');
    expect(v.cancelledBeforeDeparture).toBeNull();
    expect(v.held.cancelledBeforeDeparture).toBe('kurang dari 3');
    expect(v.rescheduled).toBe(3);
    // 2 failed in all, both of one reason, and 2 rescheduled: every count held, and the total with them
    const tiny = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ failed: 2, noShow: 0, otherFailed: 2, rescheduled: 2 })) });
    const tv = (await ask(tiny.service, 'K-04')).value as { failed: number | null; rescheduled: number | null; held: Record<string, string> };
    expect(tv.failed).toBeNull();
    expect(tv.held.failed).toBe('ditahan');
    expect(tv.rescheduled).toBeNull();
    expect(tv.held.rescheduled).toBe('kurang dari 3');
    const down = make(BOTH, { cancelledBeforeDeparture: jest.fn(async () => null) });
    expect(await ask(down.service, 'K-04')).toMatchObject({ status: 'belum_ada', value: null });
    const mixed = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ thresholdMinutes: null })) });
    expect((await ask(mixed.service, 'K-02')).label).toContain('berbeda antar depot');
  });

  it('K-02 with every verdict stored does not claim a recomputation; with none delivered it is belum_ada, not 0%', async () => {
    const stored = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ storedVerdicts: 40 })) });
    expect((await ask(stored.service, 'K-02')).label).not.toContain('dihitung ulang');
    const empty = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ delivered: 0, onTime: 0, storedVerdicts: 0, medianMinutes: null, couriers: 0, failed: 0, noShow: 0, otherFailed: 0 })) });
    for (const id of ['K-02', 'K-03']) expect(await ask(empty.service, id)).toMatchObject({ status: 'belum_ada', value: null });
    // K-01 with nothing delivered is a real 0
    expect(await ask(empty.service, 'K-01')).toMatchObject({ status: 'ok', value: 0 });
  });

  it('a month closed 7 days ago is still held, and from the 8th it is answered (late cancellations settle first)', async () => {
    const day = (d: string) => new Date(`2026-12-${d}T03:00:00.000Z`);
    for (const id of ['K-01', 'K-02', 'K-05']) {
      const early = make();
      const held = await early.service.answer(id, user, NOVEMBER, day('07'));
      expect(held).toMatchObject({ status: 'ditahan', value: null });
      expect(held.reason).toContain('mulai tanggal 8 bulan berikutnya');
      const settled = await make().service.answer(id, user, NOVEMBER, day('08'));
      expect(settled.status).toBe('ok');
    }
  });

  it('K-01 to K-05 answer ONE closed month, and only behind 3 or more couriers: 1 or 2 couriers ARE the number', async () => {
    const { service, sources } = make();
    // nested periods (d1..d7 and d1..d6) would subtract into one courier's day: only a whole month is a period here
    for (const id of ['K-01', 'K-02', 'K-03', 'K-04', 'K-05']) {
      for (const q of [{ period: 'day', date: '2026-11-10' }, { period: 'week', date: '2026-11-10' }, { from: '2026-11-03', to: '2026-11-09' }, { from: '2026-10-01', to: '2026-11-30' }, { period: 'year', date: '2025-11-10' }] as Record<string, string>[]) {
        await expect(ask(service, id, q)).rejects.toBeInstanceOf(BadRequestException);
      }
    }
    expect(sources.deliverySummary).not.toHaveBeenCalled();
    // the running month is not closed: held, nothing read (a day-by-day watch would step by one courier's day)
    for (const id of ['K-01', 'K-02', 'K-03', 'K-04', 'K-05']) {
      const a = await askOpen(service, id);
      expect(a).toMatchObject({ status: 'ditahan', value: null });
      expect(a.reason).toContain('mulai tanggal 8 bulan berikutnya');
    }
    expect(sources.deliverySummary).not.toHaveBeenCalled();
    for (const couriers of [1, 2]) {
      const small = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ couriers })) });
      for (const id of ['K-01', 'K-02', 'K-03', 'K-04', 'K-05']) {
        const a = await ask(small.service, id);
        expect(a).toMatchObject({ status: 'ditahan', value: null });
        expect(a.reason).toContain('kurang dari 3');
      }
    }
    // a courier who only FAILED is a courier: two failing couriers behind a slice with no delivery at all
    const failedOnly = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ delivered: 0, onTime: 0, storedVerdicts: 0, medianMinutes: null, couriers: 2, failed: 3, noShow: 1, otherFailed: 2 })) });
    for (const id of ['K-01', 'K-04']) expect(await ask(failedOnly.service, id)).toMatchObject({ status: 'ditahan', value: null });
    const three = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ couriers: 3 })) });
    expect(await ask(three.service, 'K-01')).toMatchObject({ status: 'ok' });
  });

  it('K-05 is a group: fewer than 3 couriers is held back, 3 or more is answered without any per-courier cell', async () => {
    const { service } = make();
    const a = await ask(service, 'K-05');
    expect(a.value).toEqual({ couriers: 5, delivered: 40, failed: 6, averageDeliveredPerCourier: 8, onTimeRatePct: 85 });
    for (const couriers of [1, 2]) {
      const small = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ couriers })) });
      expect(await ask(small.service, 'K-05')).toMatchObject({ status: 'ditahan', value: null });
    }
    const three = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ couriers: 3 })) });
    expect(await ask(three.service, 'K-05')).toMatchObject({ status: 'ok' });
    const none = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ couriers: 0, delivered: 0, onTime: 0, storedVerdicts: 0, medianMinutes: null })) });
    expect(await ask(none.service, 'K-05')).toMatchObject({ status: 'belum_ada' });
    // 3 couriers who all failed and delivered nothing: there is no on-time rate to give
    const failedAll = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ delivered: 0, onTime: 0, storedVerdicts: 0, medianMinutes: null, couriers: 3, failed: 5, noShow: 5, otherFailed: 0 })) });
    expect(await ask(failedAll.service, 'K-05')).toMatchObject({ status: 'belum_ada' });
    // one month only: a week and a month could be subtracted to isolate a courier's few days
    await expect(ask(service, 'K-05', { period: 'week', date: '2026-11-10' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('K-06 (a rating of one courier) is never answered', async () => {
    expect(await ask(make().service, 'K-06')).toMatchObject({ status: 'ditahan', value: null });
  });

  it('K-07 splits every status into its group: not confirmed, no courier yet, with a courier', async () => {
    const { service, sources } = make();
    const a = await ask(service, 'K-07');
    // CREATED 3 | CONFIRMED 4 + PREPARING 5 | DRIVER_ASSIGNED 3 + PICKED_UP 6 + ON_DELIVERY 7
    expect(a.value).toEqual({ total: 28, notConfirmed: 3, withoutCourier: 9, withCourier: 16, held: {}, heldBackDepots: 0 });
    expect(sources.liveOrders).toHaveBeenCalledWith([D1, D2]);
    expect(a.label).toContain('Penjualan kasir tidak ikut');
    // one status at a time: each lands in exactly one group
    for (const [status, group] of [
      ['CREATED', 'notConfirmed'],
      ['CONFIRMED', 'withoutCourier'],
      ['PREPARING', 'withoutCourier'],
      ['DRIVER_ASSIGNED', 'withCourier'],
      ['PICKED_UP', 'withCourier'],
      ['ON_DELIVERY', 'withCourier'],
    ] as const) {
      const one = make(BOTH, { liveOrders: jest.fn(async () => [{ status, count: 7 }]) });
      const v = (await ask(one.service, 'K-07')).value as Record<string, number | null>;
      expect(v[group]).toBe(7);
      for (const other of ['notConfirmed', 'withoutCourier', 'withCourier'].filter((g) => g !== group)) expect(v[other]).toBe(0);
    }
    // a status this reader does not know makes the groups fall short of the total: not an answer
    const odd = make(BOTH, { liveOrders: jest.fn(async () => [{ status: 'MYSTERY', count: 7 }]) });
    expect(await ask(odd.service, 'K-07')).toMatchObject({ status: 'belum_ada' });
  });

  it('K-07 is as of TODAY whatever period is asked, and a group of 1 or 2 orders is held back', async () => {
    const { service, sources } = make(scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-26', '2026-11-30')]));
    const a = await ask(service, 'K-07', { period: 'month', date: '2026-01-10' });
    // the period echoed is today's, and the depots are those readable today (D2 only from 26 Nov)
    expect(a.period).toMatchObject({ unit: 'day', from: '2026-11-25', to: '2026-11-25' });
    expect(sources.liveOrders).toHaveBeenCalledWith([D1]);
    const small = make(BOTH, { liveOrders: jest.fn(async () => [{ status: 'CREATED', count: 2 }, { status: 'CONFIRMED', count: 20 }, { status: 'ON_DELIVERY', count: 9 }]) });
    const v = (await ask(small.service, 'K-07')).value as { total: number | null; notConfirmed: number | null; withoutCourier: number | null; withCourier: number | null; held: Record<string, string> };
    expect(v.notConfirmed).toBeNull();
    expect(v.held.notConfirmed).toBe('kurang dari 3');
    // 31 in all, the 2 held: the smallest neighbour goes with it so 31 - 20 - 9 is not 2
    expect(v.withCourier).toBeNull();
    expect(v.held.withCourier).toBe('ditahan');
    // two orders in all, all with a courier: held, and no total to subtract from
    const two = make(BOTH, { liveOrders: jest.fn(async () => [{ status: 'ON_DELIVERY', count: 2 }]) });
    const tv = (await ask(two.service, 'K-07')).value as { total: number | null; withCourier: number | null; held: Record<string, string> };
    expect(tv.total).toBeNull();
    expect(tv.held.total).toBe('ditahan');
    expect(tv.withCourier).toBeNull();
    const quiet = make(BOTH, { liveOrders: jest.fn(async () => []) });
    expect(await ask(quiet.service, 'K-07')).toMatchObject({ status: 'ok', value: { total: 0, notConfirmed: 0 } });
    const gone = make(scopeOf([span(D2, '2026-11-26', '2026-11-30')]));
    expect(await ask(gone.service, 'K-07')).toMatchObject({ status: 'belum_ada' });
  });

  it('K-07 holds back a depot whose older orders predate the days its role may read it', async () => {
    const { service, sources } = make(BOTH, {}, { [D2]: '2026-11-10' });
    const a = await ask(service, 'K-07');
    expect(sources.liveOrders).toHaveBeenCalledWith([D1]);
    expect((a.value as { heldBackDepots: number }).heldBackDepots).toBe(1);
    expect(a.label).toContain('2026-11-10');
    const all = make(BOTH, {}, { [D1]: '2026-11-10', [D2]: null });
    expect(await ask(all.service, 'K-07')).toMatchObject({ status: 'ditahan', value: null });
    expect(all.sources.liveOrders).not.toHaveBeenCalled();
  });

  it('fails closed: a source that cannot answer, no depot, or more than 100 depots is belum_ada', async () => {
    const down = make(BOTH, { deliverySummary: jest.fn(async () => null), liveOrders: jest.fn(async () => null), cancelledBeforeDeparture: jest.fn(async () => null) });
    for (const id of ['K-01', 'K-02', 'K-03', 'K-04', 'K-05', 'K-07']) {
      expect(await ask(down.service, id)).toMatchObject({ status: 'belum_ada', value: null });
    }
    expect(await ask(make(NONE).service, 'K-01')).toMatchObject({ status: 'belum_ada' });
    expect(await ask(make(NONE).service, 'K-06')).toMatchObject({ status: 'ditahan' });
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const wide = make(scopeOf(many.map((d) => span(d, '2026-11-01', '2026-11-30'))));
    for (const id of ['K-01', 'K-07']) expect(await ask(wide.service, id)).toMatchObject({ status: 'belum_ada' });
    expect(wide.sources.deliverySummary).not.toHaveBeenCalled();
    await expect(ask(make().service, 'C-01')).rejects.toBeInstanceOf(NotFoundException);
  });
});

const ledger = (depotId: string, o: Partial<GallonLedgerRow> = {}): GallonLedgerRow => ({
  depotId,
  issuedTotal: 0,
  returnedTotal: 0,
  depositHeldTotal: 0,
  depositRefundedTotal: 0,
  issuedInWindow: 0,
  depositHeldInWindow: 0,
  returnedGoodInWindow: 0,
  returnedDamagedInWindow: 0,
  depositRefundedInWindow: 0,
  ...o,
});

describe('gallon metrics (G-)', () => {
  const make = (scope: ReadScope = BOTH, over: Record<string, unknown> = {}, held: Record<string, string | null> = {}) => {
    const sources = {
      gallonsSold: jest.fn(async () => 321),
      refillSplit: jest.fn(async () => ({ refill: 10, partial: 2, beli: 3, notAsked: 1 })),
      gallonLedger: jest.fn(async (ids: string[], r: { from: string; to: string }) =>
        ids.map((d) =>
          r.from === r.to
            ? ledger(d, { issuedTotal: 100, returnedTotal: 70, depositHeldTotal: 1_500_000, depositRefundedTotal: 1_050_000 })
            : ledger(d, { issuedInWindow: 20, returnedGoodInWindow: 12, returnedDamagedInWindow: 3, depositHeldInWindow: 300_000, depositRefundedInWindow: 225_000 }),
        ),
      ),
      ...over,
    };
    return { sources, service: new GallonMetricsService(scopes(scope), cumulative(held), sources as never) };
  };
  const ask = (s: GallonMetricsService, id: string, q: Record<string, string> = NOVEMBER) => s.answer(id, user, q, NOW);

  it('lists the dictionary; G-01 and G-05 count over the granted spans for any period', async () => {
    expect(GALLON_METRIC_IDS).toEqual(['G-01', 'G-02', 'G-03', 'G-04', 'G-05']);
    expect(GALLON_METRICS['G-03'].unit).toBe('Rp');
    const { service, sources } = make(DAY10);
    expect(await ask(service, 'G-01', { period: 'day', date: '2026-11-10' })).toMatchObject({ status: 'ok', value: 321, unit: 'galon' });
    expect(sources.gallonsSold).toHaveBeenCalledWith([
      { depotId: D1, from: '2026-11-09T17:00:00.000Z', to: '2026-11-10T17:00:00.000Z' },
      { depotId: D2, from: '2026-11-09T17:00:00.000Z', to: '2026-11-10T17:00:00.000Z' },
    ]);
    const g5 = await ask(make().service, 'G-05', { from: '2026-11-01', to: '2026-11-07' });
    expect(g5.value).toEqual({ refill: 10, partial: 2, beli: 3, notAsked: 1 });
    expect(g5.label).toContain('Menghitung transaksi');
  });

  it('G-02 and G-03 give the balance at the day the period ends (today while it runs) and what moved', async () => {
    const { service, sources } = make();
    const g2 = await ask(service, 'G-02');
    // two depots: balance (100 - 70) each, moved 20 issued and 15 returned each
    expect(g2.value).toEqual({ asOf: '2026-11-25', heldBackDepots: 0, gallonsAtCustomers: 60, issuedInPeriod: 40, returnedInPeriod: 30 });
    // the balance is read at the end of 25 Nov WIB, the movements over the whole stretch
    expect(sources.gallonLedger).toHaveBeenCalledWith([D1, D2], { from: '2026-11-25T17:00:00.000Z', to: '2026-11-25T17:00:00.000Z' });
    expect(sources.gallonLedger).toHaveBeenCalledWith([D1, D2], { from: NOV_FROM, to: NOV_TO });
    const g3 = await ask(service, 'G-03');
    expect(g3.value).toEqual({ asOf: '2026-11-25', heldBackDepots: 0, depositHeldIdr: 900_000, bookedInPeriodIdr: 600_000, refundedInPeriodIdr: 450_000 });
    expect(g3.label).toContain('bukan omzet');
    // a finished month: balance at its last day
    const past = make(OCT);
    expect((await ask(past.service, 'G-02', OCTOBER)).value).toMatchObject({ asOf: '2026-10-31' });
  });

  it('reads the moves of a depot that changed entity only for the days it may be read, and its balance only if readable on the last day', async () => {
    const { service, sources } = make(scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D2, '2026-11-01', '2026-11-30')]));
    await ask(service, 'G-02');
    // the balance: D1 is no longer readable at 25 Nov
    expect(sources.gallonLedger).toHaveBeenCalledWith([D2], { from: '2026-11-25T17:00:00.000Z', to: '2026-11-25T17:00:00.000Z' });
    expect(sources.gallonLedger).toHaveBeenCalledWith([D1], { from: NOV_FROM, to: '2026-11-15T17:00:00.000Z' });
    expect(sources.gallonLedger).toHaveBeenCalledWith([D2], { from: NOV_FROM, to: NOV_TO });
    const none = make(scopeOf([span(D1, '2026-11-01', '2026-11-15')]));
    expect(await ask(none.service, 'G-03')).toMatchObject({ status: 'belum_ada' });
  });

  it('G-02 and G-03 hold back a depot whose older ledger predates the days its role may read it, never mixing it in', async () => {
    const { service, sources } = make(BOTH, {}, { [D2]: '2026-11-10' });
    const g2 = await ask(service, 'G-02');
    // the balance covers D1 only; the period's movements are each depot's own readable days, as before
    expect(sources.gallonLedger).toHaveBeenCalledWith([D1], { from: '2026-11-25T17:00:00.000Z', to: '2026-11-25T17:00:00.000Z' });
    expect(g2.value).toMatchObject({ gallonsAtCustomers: 30, heldBackDepots: 1 });
    expect(g2.label).toContain('2026-11-10');
    const g3 = await ask(service, 'G-03');
    expect(g3.value).toMatchObject({ depositHeldIdr: 450_000, heldBackDepots: 1 });
    const all = make(BOTH, {}, { [D1]: '2026-11-10', [D2]: null });
    expect(await ask(all.service, 'G-03')).toMatchObject({ status: 'ditahan', value: null });
  });

  it('G-04 gives good and damaged returns of the period', async () => {
    const { service } = make();
    expect((await ask(service, 'G-04')).value).toEqual({ good: 24, damaged: 6 });
  });

  it('fails closed on any source, and reads more than 100 depots in several calls without dropping any', async () => {
    const down = make(BOTH, { gallonsSold: jest.fn(async () => null), refillSplit: jest.fn(async () => null), gallonLedger: jest.fn(async () => null) });
    for (const id of GALLON_METRIC_IDS) expect(await ask(down.service, id)).toMatchObject({ status: 'belum_ada', value: null });
    expect(await ask(make(NONE).service, 'G-01')).toMatchObject({ status: 'belum_ada' });
    const many = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const wide = make(scopeOf(many.map((d) => span(d, '2026-11-01', '2026-11-30'))));
    expect(await ask(wide.service, 'G-01')).toMatchObject({ status: 'belum_ada' });
    const g4 = await ask(wide.service, 'G-04');
    expect(g4.value).toEqual({ good: 150 * 12, damaged: 150 * 3 });
    // one of the chunked reads failing is a failure of the answer
    let n = 0;
    const flaky = make(scopeOf(many.map((d) => span(d, '2026-11-01', '2026-11-30'))), {
      gallonLedger: jest.fn(async (ids: string[]) => (n++ === 1 ? null : ids.map((d) => ledger(d)))),
    });
    expect(await ask(flaky.service, 'G-04')).toMatchObject({ status: 'belum_ada' });
    // the balance's own failure, with the movements fine
    const balanceDown = make(BOTH, {
      gallonLedger: jest.fn(async (ids: string[], r: { from: string; to: string }) => (r.from === r.to ? null : ids.map((d) => ledger(d)))),
    });
    expect(await ask(balanceDown.service, 'G-02')).toMatchObject({ status: 'belum_ada' });
    await expect(ask(make().service, 'G-09')).rejects.toBeInstanceOf(NotFoundException);
  });
});
