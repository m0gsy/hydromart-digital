import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { CUSTOMER_METRIC_IDS, CUSTOMER_METRICS, CustomerMetricsService } from '../../src/application/ai-read/customer-metrics';
import { DELIVERY_METRIC_IDS, DELIVERY_METRICS, DeliveryMetricsService } from '../../src/application/ai-read/delivery-metrics';
import { GALLON_BALANCE_CAVEAT, GALLON_METRIC_IDS, GALLON_METRICS, GallonMetricsService } from '../../src/application/ai-read/gallon-metrics';
import { assertNoPersonalData } from '../../src/application/ai-read/masking';
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
const NOW = new Date('2026-11-25T03:00:00.000Z'); // 10:00 WIB 25 Nov
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

const window = (o: Partial<{ active: number; newCustomers: number; repeat: number; newAtDepot: { depotId: string; customers: number }[] }> = {}) => ({
  active: 40,
  newCustomers: 12,
  repeat: 25,
  newAtDepot: [{ depotId: D1, customers: 9 }],
  ...o,
});

describe('customer metrics (C-)', () => {
  const make = (scope: ReadScope = BOTH, over: Record<string, unknown> = {}) => {
    const sources = {
      customerWindow: jest.fn(async () => window()),
      cohorts: jest.fn(async () => [
        { cohort: '2026-09', monthIndex: 0, customers: 20 },
        { cohort: '2026-09', monthIndex: 1, customers: 8 },
        { cohort: '2026-09', monthIndex: 2, customers: 2 },
        { cohort: '2026-10', monthIndex: 0, customers: 2 },
        { cohort: '2026-10', monthIndex: 1, customers: 1 },
      ]),
      ratings: jest.fn(async () => ({ reviews: 10, ratingSum: 43, reviewers: 6 })),
      segments: jest.fn(async () => ({ active: 30, atRisk: 12, inactive: 50 })),
      ...over,
    };
    return { sources, service: new CustomerMetricsService(scopes(scope), sources as never) };
  };
  const ask = (s: CustomerMetricsService, id: string, q: Record<string, string> = NOVEMBER) => s.answer(id, user, q, NOW);

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
    // everything small: held as a whole
    const tiny = make(BOTH, { customerWindow: jest.fn(async () => window({ active: 2, repeat: 1 })) });
    expect(await ask(tiny.service, 'C-05')).toMatchObject({ status: 'ditahan' });
    // no buyers at all: nothing to say
    const none = make(BOTH, { customerWindow: jest.fn(async () => window({ active: 0, repeat: 0, newCustomers: 0 })) });
    expect(await ask(none.service, 'C-05')).toMatchObject({ status: 'belum_ada' });
  });

  it('C-06 takes the day after the month ends as its limit, or today while the month runs, and masks small segments', async () => {
    const { service, sources } = make();
    const a = await ask(service, 'C-06');
    expect(a.status).toBe('ok');
    // as of today (25 Nov WIB): 30 days back is 26 Oct, 60 days back is 26 Sep, the limit is 26 Nov 00:00 WIB
    expect(sources.segments).toHaveBeenCalledWith([D1, D2], {
      activeSince: '2026-10-25T17:00:00.000Z',
      riskSince: '2026-09-25T17:00:00.000Z',
      until: '2026-11-25T17:00:00.000Z',
    });
    expect((a.value as { asOf: string }).asOf).toBe('2026-11-25');
    const past = make(OCT);
    await ask(past.service, 'C-06', OCTOBER);
    expect(past.sources.segments).toHaveBeenCalledWith([D1, D2], expect.objectContaining({ until: '2026-10-31T17:00:00.000Z' }));
    // 2 at-risk people: held, and the smallest neighbour with them so the total cannot give them away
    const small = make(BOTH, { segments: jest.fn(async () => ({ active: 30, atRisk: 2, inactive: 50 })) });
    const s = (await ask(small.service, 'C-06')).value as { cells: { key: string; value: number | null; flag?: string }[]; total: number | null };
    expect(s.cells.find((c) => c.key === 'berisiko')).toEqual({ key: 'berisiko', value: null, flag: 'kurang dari 3' });
    expect(s.cells.find((c) => c.key === 'aktif')).toMatchObject({ value: null, flag: 'ditahan' });
    expect(s.cells.find((c) => c.key === 'tidak aktif')).toMatchObject({ value: 50 });
    const only = make(BOTH, { segments: jest.fn(async () => ({ active: 1, atRisk: 2, inactive: 0 })) });
    expect(await ask(only.service, 'C-06')).toMatchObject({ status: 'ditahan' });
    const empty = make(BOTH, { segments: jest.fn(async () => ({ active: 0, atRisk: 0, inactive: 0 })) });
    expect(await ask(empty.service, 'C-06')).toMatchObject({ status: 'belum_ada' });
  });

  it('C-06 reads the depots readable on the last day only', async () => {
    const late = make(scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-26', '2026-11-30')]));
    await ask(late.service, 'C-06');
    expect(late.sources.segments).toHaveBeenCalledWith([D1], expect.anything());
    const gone = make(scopeOf([span(D2, '2026-11-26', '2026-11-30')]));
    expect(await ask(gone.service, 'C-06')).toMatchObject({ status: 'belum_ada' });
  });

  it('C-08 holds back a cohort or a cell of fewer than 3 people', async () => {
    const { service } = make();
    const a = await ask(service, 'C-08', { from: '2026-09-01', to: '2026-11-30' });
    expect(a.status).toBe('ok');
    const rows = (a.value as { cohorts: { cohort: string; size: number | null; flag?: string; months: { monthIndex: number; customers: number | null; ratePct: number | null; flag?: string }[] }[] }).cohorts;
    expect(rows[0]).toMatchObject({ cohort: '2026-09', size: 20 });
    expect(rows[0].months).toEqual([
      { monthIndex: 1, customers: 8, ratePct: 40 },
      { monthIndex: 2, customers: null, ratePct: null, flag: 'kurang dari 3' },
    ]);
    expect(rows[1]).toEqual({ cohort: '2026-10', size: null, flag: 'kurang dari 3', months: [] });
    const allSmall = make(BOTH, { cohorts: jest.fn(async () => [{ cohort: '2026-10', monthIndex: 0, customers: 1 }]) });
    expect(await ask(allSmall.service, 'C-08', { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ status: 'ditahan' });
    const empty = make(BOTH, { cohorts: jest.fn(async () => []) });
    expect(await ask(empty.service, 'C-08', { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ status: 'belum_ada' });
    // a cohort row without a month-0 cell is not a cohort of anyone
    const odd = make(BOTH, { cohorts: jest.fn(async () => [{ cohort: '2026-10', monthIndex: 1, customers: 5 }]) });
    expect(await ask(odd.service, 'C-08', { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ status: 'ditahan' });
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
    await expect(ask(service, 'C-08', { period: 'year', date: '2026-11-10' })).resolves.toMatchObject({ status: 'ok' });
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
  const make = (scope: ReadScope = BOTH, over: Record<string, unknown> = {}) => {
    const sources = {
      deliverySummary: jest.fn(async () => delivered()),
      liveOrders: jest.fn(async () => [
        { status: 'CONFIRMED', count: 2 },
        { status: 'PREPARING', count: 1 },
        { status: 'ON_DELIVERY', count: 4 },
      ]),
      ...over,
    };
    return { sources, service: new DeliveryMetricsService(scopes(scope), sources as never) };
  };
  const ask = (s: DeliveryMetricsService, id: string, q: Record<string, string> = NOVEMBER) => s.answer(id, user, q, NOW);

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
    const k4 = await ask(service, 'K-04');
    expect(k4.value).toEqual({ failed: 6, noShow: 2, otherReason: 4, rescheduled: 3 });
    expect(k4.label).toContain('teks bebas');
  });

  it('K-02 with every verdict stored does not claim a recomputation; with none delivered it is belum_ada, not 0%', async () => {
    const stored = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ storedVerdicts: 40 })) });
    expect((await ask(stored.service, 'K-02')).label).not.toContain('dihitung ulang');
    const empty = make(BOTH, { deliverySummary: jest.fn(async () => delivered({ delivered: 0, onTime: 0, storedVerdicts: 0, medianMinutes: null, couriers: 0, failed: 0, noShow: 0, otherFailed: 0 })) });
    for (const id of ['K-02', 'K-03']) expect(await ask(empty.service, id)).toMatchObject({ status: 'belum_ada', value: null });
    // K-01 with nothing delivered is a real 0
    expect(await ask(empty.service, 'K-01')).toMatchObject({ status: 'ok', value: 0 });
  });

  it('K-02 to K-04 answer any period (day, week, range): they count deliveries, not people', async () => {
    const { service } = make();
    await expect(ask(service, 'K-01', { period: 'day', date: '2026-11-10' })).resolves.toMatchObject({ status: 'ok' });
    await expect(ask(service, 'K-02', { from: '2026-11-03', to: '2026-11-09' })).resolves.toMatchObject({ status: 'ok' });
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
    // one month only: a week and a month could be subtracted to isolate a courier's few days
    await expect(ask(service, 'K-05', { period: 'week', date: '2026-11-10' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('K-06 (a rating of one courier) is never answered', async () => {
    expect(await ask(make().service, 'K-06')).toMatchObject({ status: 'ditahan', value: null });
  });

  it('K-07 counts orders in flight now at the depots readable today, the ones without a courier apart', async () => {
    const { service, sources } = make(scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-26', '2026-11-30')]));
    const a = await ask(service, 'K-07');
    expect(a.value).toEqual({ total: 7, withoutCourier: 3, withCourier: 4, byStatus: { CONFIRMED: 2, PREPARING: 1, ON_DELIVERY: 4 } });
    expect(sources.liveOrders).toHaveBeenCalledWith([D1]);
    const quiet = make(BOTH, { liveOrders: jest.fn(async () => []) });
    expect(await ask(quiet.service, 'K-07')).toMatchObject({ status: 'ok', value: { total: 0 } });
    const gone = make(scopeOf([span(D2, '2026-11-26', '2026-11-30')]));
    expect(await ask(gone.service, 'K-07')).toMatchObject({ status: 'belum_ada' });
  });

  it('fails closed: a source that cannot answer, no depot, or more than 100 depots is belum_ada', async () => {
    const down = make(BOTH, { deliverySummary: jest.fn(async () => null), liveOrders: jest.fn(async () => null) });
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
  const make = (scope: ReadScope = BOTH, over: Record<string, unknown> = {}) => {
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
    return { sources, service: new GallonMetricsService(scopes(scope), sources as never) };
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

  it('G-02 and G-03 give the balance at the day the period ends (today while it runs) and what moved, with the caveat', async () => {
    const { service, sources } = make();
    const g2 = await ask(service, 'G-02');
    // two depots: balance (100 - 70) each, moved 20 issued and 15 returned each
    expect(g2.value).toEqual({ asOf: '2026-11-25', gallonsAtCustomers: 60, issuedInPeriod: 40, returnedInPeriod: 30 });
    expect(g2.label).toContain(GALLON_BALANCE_CAVEAT);
    expect(g2.label).toContain('25 Nov 2026');
    // the balance is read at the end of 25 Nov WIB, the movements over the whole stretch
    expect(sources.gallonLedger).toHaveBeenCalledWith([D1, D2], { from: '2026-11-25T17:00:00.000Z', to: '2026-11-25T17:00:00.000Z' });
    expect(sources.gallonLedger).toHaveBeenCalledWith([D1, D2], { from: NOV_FROM, to: NOV_TO });
    const g3 = await ask(service, 'G-03');
    expect(g3.value).toEqual({ asOf: '2026-11-25', depositHeldIdr: 900_000, bookedInPeriodIdr: 600_000, refundedInPeriodIdr: 450_000 });
    expect(g3.label).toContain('bukan omzet');
    expect(g3.label).toContain(GALLON_BALANCE_CAVEAT);
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
