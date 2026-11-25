import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { LOYALTY_METRIC_IDS, LOYALTY_METRICS, LoyaltyMetricsService, OPEN_MONTH_REASON, round5 } from '../../src/application/ai-read/loyalty-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { AiLoyaltySourcesPort } from '../../src/application/ports/ai-loyalty-sources.port';
import { AiReadSourcesPort } from '../../src/application/ports/ai-read-sources.port';

/*
 * HD-6 H4 part 2: loyalty, referral, promo cost, subscriptions, campaigns and open queues. The sources
 * are stubbed; what is under test is what each metric does with them: the door it keeps (a closed whole
 * month for people, the whole network for a role that reads all of it), the masking of small groups,
 * the stretch of days each depot may be read for, the WIB instants asked for, and belum_ada / ditahan
 * instead of a number.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-25T03:00:00.000Z'); // 10:00 WIB, 25 Nov
const OCTOBER = { period: 'month', date: '2026-10-10' }; // a closed month
const NOVEMBER = { period: 'month', date: '2026-11-10' }; // the running month

const network = { sub: 'u1', role: 'SUPER_ADMIN', depotId: null } as unknown as AuthenticatedUser;
const manager = { sub: 'u2', role: 'MANAGER', depotId: D1, depotIds: [D1] } as unknown as AuthenticatedUser;
const span = (depotId: string, from: string, to: string, legalEntityId: string | null = PT_A) => ({ depotId, legalEntityId, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: {
    depotIds: [...new Set(spans.map((s) => s.depotId))].sort(),
    legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
  },
});
const OCT_WHOLE = scopeOf([span(D1, '2026-10-01', '2026-10-31'), span(D2, '2026-10-01', '2026-10-31', PT_B)]);
// D1 changes legal entity on 16 Oct: PT_A first half, PT_B second half, and only the second half is readable.
const OCT_SPLIT = scopeOf([span(D1, '2026-10-16', '2026-10-31', PT_B), span(D2, '2026-10-01', '2026-10-31', PT_B)]);
const TODAY_SCOPE = scopeOf([span(D1, '2026-11-25', '2026-11-25'), span(D2, '2026-11-25', '2026-11-25', PT_B)]);

const OCT_FROM = '2026-09-30T17:00:00.000Z';
const OCT_TO = '2026-10-31T17:00:00.000Z';

function build(scope: ReadScope = OCT_WHOLE, over: Partial<Record<keyof AiLoyaltySourcesPort, jest.Mock>> = {}, grant: { all: boolean; legalEntityIds: string[] } | null = { all: true, legalEntityIds: [] }) {
  const sources = {
    redemptions: jest.fn(async () => ({ redemptions: 9, points: 4500, redeemers: 6, unplaced: 0 })),
    pointsOutstanding: jest.fn(async () => ({ accounts: 1234, points: 987_650 })),
    referrals: jest.fn(async () => ({ invited: 30, qualified: 12, qualifiedReferrers: 8, referrerPoints: 600, refereePoints: 300 })),
    discounts: jest.fn(async () => ({ orders: 400, discountedOrders: 90, discountIdr: 1_234_567.4 })),
    newSubscriptions: jest.fn(async () => ({ subscriptions: 25, subscribers: 20 })),
    campaigns: jest.fn(async () => ({ campaigns: 3, sent: 900, failed: 40, skipped: 60, other: 0 })),
    openQueues: jest.fn(async (ids: readonly string[]) => ids.map((depotId) => ({ depotId, incidents: 2, disputes: 1, approvals: 3, maintenanceOverdue: 1 }))),
    ...over,
  };
  const grants = { aiGrants: jest.fn(async () => grant) };
  const resolve = jest.fn(async () => scope);
  const service = new LoyaltyMetricsService(
    { resolve } as unknown as ReadScopeService,
    sources as unknown as AiLoyaltySourcesPort,
    grants as unknown as AiReadSourcesPort,
  );
  return { service, sources, grants, resolve };
}

describe('LoyaltyMetricsService, the registry and the metrics that stay belum_ada', () => {
  it('knows O-01..O-09 and A-01', () => {
    expect(LOYALTY_METRIC_IDS).toEqual(['O-01', 'O-02', 'O-03', 'O-04', 'O-05', 'O-06', 'O-07', 'O-08', 'O-09', 'A-01']);
  });

  it.each(['O-01', 'O-03', 'O-05'] as const)('%s answers belum_ada with its own reason and no number, whatever the period', async (id) => {
    const { service, sources } = build();
    for (const q of [OCTOBER, NOVEMBER, { period: 'day', date: '2026-11-03' }]) {
      const res = await service.answer(id, network, q, NOW);
      expect(res).toMatchObject({ metricId: id, status: 'belum_ada', value: null, unit: LOYALTY_METRICS[id].unit });
      expect(res.reason).toBe(LOYALTY_METRICS[id].reason);
    }
    for (const fn of Object.values(sources)) expect(fn).not.toHaveBeenCalled();
  });

  it('404s an unknown id, refuses a bad period, and fails when the scope cannot be read', async () => {
    const { service } = build();
    await expect(service.answer('O-99', network, OCTOBER, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.answer('O-01', network, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
    const down = new LoyaltyMetricsService(
      { resolve: jest.fn().mockRejectedValue(new Error('scope down')) } as unknown as ReadScopeService,
      {} as AiLoyaltySourcesPort,
      {} as AiReadSourcesPort,
    );
    await expect(down.answer('O-01', network, OCTOBER, NOW)).rejects.toThrow('scope down');
  });
});

describe('people metrics: one closed whole month only', () => {
  const PEOPLE = ['O-02', 'O-04', 'O-06', 'O-08', 'O-09'] as const;

  it.each(PEOPLE)('%s is a 400 for a day, a week, a year, a range over two months, or a range that is not a whole month', async (id) => {
    const { service } = build();
    for (const q of [
      { period: 'day', date: '2026-10-10' },
      { period: 'week', date: '2026-10-10' },
      { period: 'year', date: '2026-10-10' },
      { from: '2026-09-01', to: '2026-10-31' },
      { from: '2026-10-05', to: '2026-10-20' },
      { from: '2026-10-01', to: '2026-10-30' },
    ]) {
      await expect(service.answer(id, network, q, NOW)).rejects.toBeInstanceOf(BadRequestException);
    }
    // a range that IS one whole month is the same as the month
    expect((await service.answer(id, network, { from: '2026-10-01', to: '2026-10-31' }, NOW)).period).toMatchObject({ unit: 'range', from: '2026-10-01', to: '2026-10-31' });
  });

  it.each(PEOPLE)('%s holds the running month back and reads nothing', async (id) => {
    const { service, sources } = build();
    const res = await service.answer(id, network, NOVEMBER, NOW);
    expect(res).toMatchObject({ status: 'ditahan', value: null, reason: OPEN_MONTH_REASON });
    expect(OPEN_MONTH_REASON).toContain('bulan berjalan belum ditutup');
    for (const fn of Object.values(sources)) expect(fn).not.toHaveBeenCalled();
    // the last day of the month is still "running" until the month is over
    const edge = await service.answer(id, network, { period: 'month', date: '2026-11-30' }, new Date('2026-11-30T16:00:00.000Z'));
    expect(edge.status).toBe('ditahan');
    // ...and the first day of the next month closes it
    const closed = await service.answer(id, network, { period: 'month', date: '2026-11-30' }, new Date('2026-11-30T17:00:00.000Z'));
    expect(closed.status).not.toBe('ditahan');
  });
});

describe('O-02, points redeemed', () => {
  it('asks for the WIB instants of each stretch and answers the dictionary example', async () => {
    const { service, sources } = build();
    const res = await service.answer('O-02', network, OCTOBER, NOW);
    expect(res).toMatchObject({ status: 'ok', unit: 'poin, orang', value: { points: 4500, redemptions: 9, redeemers: 6 } });
    expect(sources.redemptions).toHaveBeenCalledWith([
      { depotId: D1, from: OCT_FROM, to: OCT_TO },
      { depotId: D2, from: OCT_FROM, to: OCT_TO },
    ]);
    expect(res.label).toContain('diserahkan');
  });

  it('asks only for the days a depot that changed legal entity mid-month was readable', async () => {
    const { service, sources } = build(OCT_SPLIT);
    await service.answer('O-02', network, OCTOBER, NOW);
    expect(sources.redemptions).toHaveBeenCalledWith([
      { depotId: D1, from: '2026-10-15T17:00:00.000Z', to: OCT_TO },
      { depotId: D2, from: OCT_FROM, to: OCT_TO },
    ]);
  });

  it('holds back a group of 1 or 2 redeemers, answers 3, and a real 0', async () => {
    for (const redeemers of [1, 2]) {
      const { service } = build(OCT_WHOLE, { redemptions: jest.fn(async () => ({ redemptions: redeemers, points: 800, redeemers, unplaced: 0 })) });
      const res = await service.answer('O-02', network, OCTOBER, NOW);
      expect(res).toMatchObject({ status: 'ditahan', value: null });
      expect(res.reason).toContain('kurang dari 3');
    }
    const three = build(OCT_WHOLE, { redemptions: jest.fn(async () => ({ redemptions: 3, points: 800, redeemers: 3, unplaced: 0 })) });
    expect((await three.service.answer('O-02', network, OCTOBER, NOW)).status).toBe('ok');
    const none = build(OCT_WHOLE, { redemptions: jest.fn(async () => ({ redemptions: 0, points: 0, redeemers: 0, unplaced: 0 })) });
    expect(await none.service.answer('O-02', network, OCTOBER, NOW)).toMatchObject({ status: 'ok', value: { points: 0, redemptions: 0, redeemers: 0 } });
  });

  it('is belum_ada when the source is down, when a handed-over reward has no depot, or when there are too many spans', async () => {
    const down = build(OCT_WHOLE, { redemptions: jest.fn(async () => null) });
    expect(await down.service.answer('O-02', network, OCTOBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
    const unplaced = build(OCT_WHOLE, { redemptions: jest.fn(async () => ({ redemptions: 9, points: 4500, redeemers: 6, unplaced: 2 })) });
    const res = await unplaced.service.answer('O-02', network, OCTOBER, NOW);
    expect(res).toMatchObject({ status: 'belum_ada', value: null });
    expect(res.reason).toContain('tanpa depot');
    // A depot-scoped caller is never told about rows outside their depots: the same source answer is ok.
    // Grants down for a caller who may read the network: nothing is published (the short total must not pass as ok).
    const grantsDown = build(OCT_WHOLE, { redemptions: jest.fn(async () => ({ redemptions: 9, points: 4500, redeemers: 6, unplaced: 2 })) }, null);
    expect(await grantsDown.service.answer('O-02', network, OCTOBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
    const scoped = build(OCT_WHOLE, { redemptions: jest.fn(async () => ({ redemptions: 9, points: 4500, redeemers: 6, unplaced: 2 })) }, { all: false, legalEntityIds: [PT_A] });
    expect(await scoped.service.answer('O-02', manager, OCTOBER, NOW)).toMatchObject({ status: 'ok', value: { points: 4500, redeemers: 6 } });
    const many = scopeOf(Array.from({ length: 101 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-10-01', '2026-10-31')));
    const big = build(many);
    expect((await big.service.answer('O-02', network, OCTOBER, NOW)).reason).toContain('persempit');
    expect(big.sources.redemptions).not.toHaveBeenCalled();
    const spans = scopeOf(Array.from({ length: 201 }, () => span(D1, '2026-10-01', '2026-10-31')));
    expect((await build(spans).service.answer('O-02', network, OCTOBER, NOW)).status).toBe('belum_ada');
  });

  it('is belum_ada when no depot is readable that month', async () => {
    const res = await build(scopeOf([])).service.answer('O-02', network, OCTOBER, NOW);
    expect(res).toMatchObject({ status: 'belum_ada', value: null });
  });

  it('never carries a name, phone, address or customer id', async () => {
    const res = await build().service.answer('O-02', network, OCTOBER, NOW);
    expect(Object.keys(res.value as object).sort()).toEqual(['points', 'redeemers', 'redemptions']);
  });
});

describe('the network door (O-04, O-06, O-08, O-09)', () => {
  it.each(['O-04', 'O-06', 'O-08', 'O-09'] as const)('%s holds back a depot-scoped role, and a role that does not read every legal entity', async (id) => {
    const scoped = build();
    expect(await scoped.service.answer(id, manager, OCTOBER, NOW)).toMatchObject({ status: 'ditahan', value: null });
    // a scoped account with no depot at all is refused the same way, not an error
    const none = { sub: 'u3', role: 'MANAGER', depotId: null } as unknown as AuthenticatedUser;
    expect((await scoped.service.answer(id, none, OCTOBER, NOW)).status).toBe('ditahan');
    const partial = build(OCT_WHOLE, {}, { all: false, legalEntityIds: [PT_B] });
    expect(await partial.service.answer(id, network, OCTOBER, NOW)).toMatchObject({ status: 'ditahan', value: null });
    for (const b of [scoped, partial]) for (const fn of Object.values(b.sources)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(['O-04', 'O-06', 'O-08', 'O-09'] as const)('%s is belum_ada when the legal-entity grants cannot be read', async (id) => {
    const { service } = build(OCT_WHOLE, {}, null);
    expect(await service.answer(id, network, OCTOBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
  });
});

describe('O-04, points outstanding', () => {
  it('asks for the ledger before the start of the day after the month, answers points exactly and people to a multiple of 5', async () => {
    const { service, sources } = build();
    const res = await service.answer('O-04', network, OCTOBER, NOW);
    expect(sources.pointsOutstanding).toHaveBeenCalledWith(OCT_TO);
    expect(res).toMatchObject({ status: 'ok', unit: 'poin, orang', value: { asOf: '2026-10-31', points: 987_650, accounts: 1235 } });
    expect(res.label).toContain('kelipatan 5');
    expect(res.label).toContain('belum ada nilai rupiah');
  });

  it('rounds to 5, holds 1 or 2 accounts back, answers a real 0, and is belum_ada when the source is down', async () => {
    expect([0, 2, 3, 7, 8, 12, 13].map(round5)).toEqual([0, 0, 5, 5, 10, 10, 15]);
    for (const [accounts, published] of [[3, 5], [4, 5], [6, 5], [7, 5]] as const) {
      const b = build(OCT_WHOLE, { pointsOutstanding: jest.fn(async () => ({ accounts, points: 1 })) });
      expect(((await b.service.answer('O-04', network, OCTOBER, NOW)).value as { accounts: number }).accounts).toBe(published);
    }
    for (const accounts of [1, 2]) {
      const b = build(OCT_WHOLE, { pointsOutstanding: jest.fn(async () => ({ accounts, points: 90 })) });
      expect(await b.service.answer('O-04', network, OCTOBER, NOW)).toMatchObject({ status: 'ditahan', value: null });
    }
    const zero = build(OCT_WHOLE, { pointsOutstanding: jest.fn(async () => ({ accounts: 0, points: 0 })) });
    expect(await zero.service.answer('O-04', network, OCTOBER, NOW)).toMatchObject({ status: 'ok', value: { points: 0, accounts: 0 } });
    const down = build(OCT_WHOLE, { pointsOutstanding: jest.fn(async () => null) });
    expect(await down.service.answer('O-04', network, OCTOBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
  });

  it('gives no two published totals a difference smaller than a rounding step of people (cell is always a multiple of 5)', async () => {
    for (const accounts of [11, 12, 13, 14, 16, 22]) {
      const b = build(OCT_WHOLE, { pointsOutstanding: jest.fn(async () => ({ accounts, points: 1 })) });
      const res = await b.service.answer('O-04', network, OCTOBER, NOW);
      expect((res.value as { accounts: number }).accounts % 5).toBe(0);
    }
  });
});

describe('O-06, referrals', () => {
  it('asks for the month as WIB instants and answers the dictionary example', async () => {
    const { service, sources } = build();
    const res = await service.answer('O-06', network, OCTOBER, NOW);
    expect(sources.referrals).toHaveBeenCalledWith({ from: OCT_FROM, to: OCT_TO });
    expect(res).toMatchObject({
      status: 'ok',
      unit: 'orang, poin, persen',
      value: { invited: { value: 30 }, qualified: { value: 12 }, points: { referrer: 600, referee: 300, total: 900 }, conversionPct: 40 },
    });
    expect(res.label).toContain('kedua sisi');
  });

  it('holds back a cell of 1 or 2 people with the flag, and the points and rate that would give them away', async () => {
    const one = build(OCT_WHOLE, { referrals: jest.fn(async () => ({ invited: 30, qualified: 2, qualifiedReferrers: 2, referrerPoints: 100, refereePoints: 50 })) });
    const res = await one.service.answer('O-06', network, OCTOBER, NOW);
    expect(res.value).toMatchObject({ invited: { value: 30 }, qualified: { value: null, flag: 'kurang dari 3' }, points: { referrer: null, referee: null, total: null, flag: 'kurang dari 3' }, conversionPct: null });
    expect(JSON.stringify(res)).not.toContain('"referrer":100');
    const few = build(OCT_WHOLE, { referrals: jest.fn(async () => ({ invited: 1, qualified: 9, qualifiedReferrers: 5, referrerPoints: 450, refereePoints: 450 })) });
    const res2 = await few.service.answer('O-06', network, OCTOBER, NOW);
    expect(res2.value).toMatchObject({ invited: { value: null, flag: 'kurang dari 3' }, qualified: { value: 9 }, conversionPct: null });
    // Many referees but one referrer: the referrer's points are one person's, and the total would give them away.
    const lone = build(OCT_WHOLE, { referrals: jest.fn(async () => ({ invited: 30, qualified: 9, qualifiedReferrers: 2, referrerPoints: 450, refereePoints: 450 })) });
    const res3 = await lone.service.answer('O-06', network, OCTOBER, NOW);
    expect(res3.value).toMatchObject({ qualified: { value: 9 }, points: { referrer: null, referee: 450, total: null, flag: 'kurang dari 3' } });
    const both = build(OCT_WHOLE, { referrals: jest.fn(async () => ({ invited: 2, qualified: 1, qualifiedReferrers: 1, referrerPoints: 50, refereePoints: 25 })) });
    expect(await both.service.answer('O-06', network, OCTOBER, NOW)).toMatchObject({ status: 'ditahan', value: null });
  });

  it('answers real zeros, a rate over 100 for a different cohort, and belum_ada when the source is down', async () => {
    const zero = build(OCT_WHOLE, { referrals: jest.fn(async () => ({ invited: 0, qualified: 0, qualifiedReferrers: 0, referrerPoints: 0, refereePoints: 0 })) });
    expect(await zero.service.answer('O-06', network, OCTOBER, NOW)).toMatchObject({
      status: 'ok',
      value: { invited: { value: 0 }, qualified: { value: 0 }, points: { total: 0 }, conversionPct: null },
    });
    const over = build(OCT_WHOLE, { referrals: jest.fn(async () => ({ invited: 4, qualified: 10, qualifiedReferrers: 6, referrerPoints: 500, refereePoints: 500 })) });
    expect((await over.service.answer('O-06', network, OCTOBER, NOW)).value).toMatchObject({ conversionPct: 250 });
    const down = build(OCT_WHOLE, { referrals: jest.fn(async () => null) });
    expect(await down.service.answer('O-06', network, OCTOBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
  });

  it('cannot be differenced: a month answered whole, never a window that overlaps another', async () => {
    const { service } = build();
    await expect(service.answer('O-06', network, { from: '2026-10-01', to: '2026-10-30' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('O-07, the cost of promos and discounts (money)', () => {
  it('answers any period, over the WIB instants each depot was readable, rounded to a full rupiah', async () => {
    const WEEK = scopeOf([span(D1, '2026-10-19', '2026-10-25', PT_B), span(D2, '2026-10-19', '2026-10-25', PT_B)]);
    const { service, sources } = build(WEEK);
    const res = await service.answer('O-07', network, { period: 'week', date: '2026-10-20' }, NOW);
    expect(res).toMatchObject({ status: 'ok', unit: 'Rp, pesanan', value: { orders: 400, discountedOrders: 90, discountIdr: 1_234_567 } });
    expect(sources.discounts).toHaveBeenCalledWith([
      { depotId: D1, from: '2026-10-18T17:00:00.000Z', to: '2026-10-25T17:00:00.000Z' },
      { depotId: D2, from: '2026-10-18T17:00:00.000Z', to: '2026-10-25T17:00:00.000Z' },
    ]);
    // the running month, a day and a range are all fine for money
    for (const q of [NOVEMBER, { period: 'day', date: '2026-11-03' }, { from: '2026-10-05', to: '2026-10-20' }]) {
      expect((await build(scopeOf([span(D1, '2026-10-01', '2026-11-30')])).service.answer('O-07', network, q, NOW)).status).toBe('ok');
    }
  });

  it('clips a depot that was readable only from the 16th to those days, and keeps the WIB day boundary', async () => {
    const { service, sources } = build(OCT_SPLIT);
    await service.answer('O-07', network, OCTOBER, NOW);
    expect(sources.discounts).toHaveBeenCalledWith([
      { depotId: D1, from: '2026-10-15T17:00:00.000Z', to: OCT_TO },
      { depotId: D2, from: OCT_FROM, to: OCT_TO },
    ]);
  });

  it('says plainly that the kinds cannot be told apart, and does not carry a person', async () => {
    const res = await build().service.answer('O-07', network, OCTOBER, NOW);
    expect((res.value as { byKind: { status: string } }).byKind.status).toBe('belum_ada');
    expect(res.label).toContain('semua jenis jadi satu');
  });

  it('is belum_ada when the source is down, nobody is readable, or there are too many depots; a real 0 is a 0', async () => {
    expect((await build(OCT_WHOLE, { discounts: jest.fn(async () => null) }).service.answer('O-07', network, OCTOBER, NOW)).status).toBe('belum_ada');
    expect((await build(scopeOf([])).service.answer('O-07', network, OCTOBER, NOW)).status).toBe('belum_ada');
    const many = scopeOf(Array.from({ length: 101 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-10-01', '2026-10-31')));
    const big = build(many);
    expect((await big.service.answer('O-07', network, OCTOBER, NOW)).reason).toContain('persempit');
    expect(big.sources.discounts).not.toHaveBeenCalled();
    const zero = build(OCT_WHOLE, { discounts: jest.fn(async () => ({ orders: 0, discountedOrders: 0, discountIdr: 0 })) });
    expect(await zero.service.answer('O-07', network, OCTOBER, NOW)).toMatchObject({ status: 'ok', value: { orders: 0, discountIdr: 0 } });
  });

  it('is open to a depot-scoped role too (a depot reads its own cost)', async () => {
    const { service } = build(scopeOf([span(D1, '2026-10-01', '2026-10-31')]));
    expect((await service.answer('O-07', manager, OCTOBER, NOW)).status).toBe('ok');
  });
});

describe('O-08, subscriptions', () => {
  it('answers the subscriptions made in the month, and says what it cannot answer', async () => {
    const { service, sources } = build();
    const res = await service.answer('O-08', network, OCTOBER, NOW);
    expect(sources.newSubscriptions).toHaveBeenCalledWith({ from: OCT_FROM, to: OCT_TO });
    expect(res).toMatchObject({ status: 'ok', unit: 'langganan, orang', value: { new: { subscriptions: 25, subscribers: 20 } } });
    const v = res.value as Record<string, { status?: string }>;
    expect(v.active.status).toBe('belum_ada');
    expect(v.stopped.status).toBe('belum_ada');
    expect(v.estimatedMonthlyDeliveries.status).toBe('belum_ada');
  });

  it('holds back 1 or 2 subscribers, answers a real 0, and is belum_ada when the source is down', async () => {
    for (const subscribers of [1, 2]) {
      const b = build(OCT_WHOLE, { newSubscriptions: jest.fn(async () => ({ subscriptions: 4, subscribers })) });
      expect(await b.service.answer('O-08', network, OCTOBER, NOW)).toMatchObject({ status: 'ditahan', value: null });
    }
    const zero = build(OCT_WHOLE, { newSubscriptions: jest.fn(async () => ({ subscriptions: 0, subscribers: 0 })) });
    expect((await zero.service.answer('O-08', network, OCTOBER, NOW)).value).toMatchObject({ new: { subscriptions: 0, subscribers: 0 } });
    const down = build(OCT_WHOLE, { newSubscriptions: jest.fn(async () => null) });
    expect((await down.service.answer('O-08', network, OCTOBER, NOW)).status).toBe('belum_ada');
  });
});

describe('O-09, campaigns', () => {
  it('answers the recipients by outcome of the campaigns that finished in the month', async () => {
    const { service, sources } = build();
    const res = await service.answer('O-09', network, OCTOBER, NOW);
    expect(sources.campaigns).toHaveBeenCalledWith({ from: OCT_FROM, to: OCT_TO });
    expect(res).toMatchObject({ status: 'ok', unit: 'orang', value: { campaigns: 3, recipients: 1000 } });
    expect((res.value as { cells: { outcome: string; value: number }[] }).cells).toEqual([
      { outcome: 'terkirim', value: 900 },
      { outcome: 'gagal', value: 40 },
      { outcome: 'dilewati', value: 60 },
      { outcome: 'lainnya', value: 0 },
    ]);
    expect(res.label).toContain('tidak ada angka "dibaca"');
  });

  it('holds a cell of 1 or 2 back with its smallest neighbour so the total cannot give it away', async () => {
    const b = build(OCT_WHOLE, { campaigns: jest.fn(async () => ({ campaigns: 1, sent: 90, failed: 1, skipped: 4, other: 0 })) });
    const res = await b.service.answer('O-09', network, OCTOBER, NOW);
    const cells = (res.value as { cells: { outcome: string; value: number | null; flag?: string }[] }).cells;
    expect(cells.find((c) => c.outcome === 'gagal')).toMatchObject({ value: null, flag: 'kurang dari 3' });
    // 1 held + the next smallest (4) is still only 5 people, so the largest is held too before the total is shown
    expect(cells.find((c) => c.outcome === 'dilewati')).toMatchObject({ value: null, flag: 'ditahan' });
    expect(cells.find((c) => c.outcome === 'terkirim')).toMatchObject({ value: null, flag: 'ditahan' });
    expect(cells.find((c) => c.outcome === 'lainnya')?.value).toBe(0);
    expect((res.value as { recipients: number | null }).recipients).toBe(95);
  });

  it('answers a total of small cells that add up to enough people, and holds everything when they do not', async () => {
    const six = build(OCT_WHOLE, { campaigns: jest.fn(async () => ({ campaigns: 1, sent: 2, failed: 2, skipped: 2, other: 0 })) });
    const sixRes = await six.service.answer('O-09', network, OCTOBER, NOW);
    expect(sixRes).toMatchObject({ status: 'ok', value: { recipients: 6 } });
    expect((sixRes.value as { cells: { flag?: string }[] }).cells.slice(0, 3).every((c) => c.flag === 'kurang dari 3')).toBe(true);
    const four = build(OCT_WHOLE, { campaigns: jest.fn(async () => ({ campaigns: 1, sent: 4, failed: 1, skipped: 0, other: 0 })) });
    expect(await four.service.answer('O-09', network, OCTOBER, NOW)).toMatchObject({ status: 'ditahan', value: null });
    const small = build(OCT_WHOLE, { campaigns: jest.fn(async () => ({ campaigns: 1, sent: 2, failed: 1, skipped: 0, other: 0 })) });
    expect(await small.service.answer('O-09', network, OCTOBER, NOW)).toMatchObject({ status: 'ditahan', value: null });
  });

  it('answers a real zero, and is belum_ada when the source is down', async () => {
    const zero = build(OCT_WHOLE, { campaigns: jest.fn(async () => ({ campaigns: 0, sent: 0, failed: 0, skipped: 0, other: 0 })) });
    expect(await zero.service.answer('O-09', network, OCTOBER, NOW)).toMatchObject({ status: 'ok', value: { campaigns: 0, recipients: 0 } });
    const down = build(OCT_WHOLE, { campaigns: jest.fn(async () => null) });
    expect((await down.service.answer('O-09', network, OCTOBER, NOW)).status).toBe('belum_ada');
  });
});

describe('A-01, open queues', () => {
  it('is about now: answered over today whatever period was sent, for the depots readable today', async () => {
    const { service, sources } = build(TODAY_SCOPE);
    for (const q of [{}, NOVEMBER, { from: '2026-11-01', to: '2026-11-30' }]) {
      const res = await service.answer('A-01', network, q, NOW);
      expect(res).toMatchObject({
        status: 'ok',
        unit: 'item',
        period: { unit: 'day', from: '2026-11-25', to: '2026-11-25' },
        value: { depots: 2, incidents: 4, disputes: 2, approvals: 6, maintenanceOverdue: 2 },
      });
    }
    expect(sources.openQueues).toHaveBeenCalledWith([D1, D2]);
    await expect(service.answer('A-01', network, { from: '2026-11-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only counts the depots readable today (a depot that joined later is left out)', async () => {
    const { service, sources } = build(scopeOf([span(D1, '2026-11-25', '2026-11-25'), span(D2, '2026-11-26', '2026-11-30')]));
    expect((await service.answer('A-01', network, {}, NOW)).value).toMatchObject({ depots: 1 });
    expect(sources.openQueues).toHaveBeenCalledWith([D1]);
  });

  it('reads 100 depots at a time and is belum_ada if any read fails; nobody readable today is belum_ada', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const wide = build(scopeOf(ids.map((id) => span(id, '2026-11-25', '2026-11-25'))));
    const res = await wide.service.answer('A-01', network, {}, NOW);
    expect(wide.sources.openQueues).toHaveBeenCalledTimes(2);
    expect(res.value).toMatchObject({ depots: 150, incidents: 300 });
    const partial = build(scopeOf(ids.map((id) => span(id, '2026-11-25', '2026-11-25'))), {
      openQueues: jest.fn().mockResolvedValueOnce(ids.slice(0, 100).map((depotId) => ({ depotId, incidents: 1, disputes: 0, approvals: 0, maintenanceOverdue: 0 }))).mockResolvedValueOnce(null),
    });
    expect(await partial.service.answer('A-01', network, {}, NOW)).toMatchObject({ status: 'belum_ada', value: null });
    expect((await build(scopeOf([span(D1, '2026-10-01', '2026-10-31')])).service.answer('A-01', network, {}, NOW)).status).toBe('belum_ada');
  });
});
