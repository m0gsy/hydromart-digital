import { BadRequestException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { GallonMetricsService } from '../../src/application/ai-read/gallon-metrics';
import { MoneyMetricsService } from '../../src/application/ai-read/money-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { SPLITTABLE_METRICS, assertSplittable, splitByDepot, wantsSplit } from '../../src/application/ai-read/split';
import { DepotSalesRow } from '../../src/application/ports/ai-money-sources.port';

/* AI-7a: split=depot on the scalar depot sums. The total is the unsplit answer; every depot of the scope appears once. */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-11-25T03:00:00.000Z');
const NOVEMBER = { period: 'month', date: '2026-11-10' };
const user = { sub: 'u1', role: 'SUPER_ADMIN', depotId: null } as unknown as AuthenticatedUser;
const span = (depotId: string, from: string, to: string) => ({ depotId, legalEntityId: PT_A, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: { depotIds: [...new Set(spans.map((s) => s.depotId))].sort(), legalEntityIds: [PT_A] },
});
// D2 is readable only from 16 Nov.
const MID = scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-16', '2026-11-30')]);
const sale = (depotId: string, o: Partial<DepotSalesRow>): DepotSalesRow => ({
  depotId, orders: 0, revenueIdr: 0, shippingIdr: 0, appOrders: 0, appRevenueIdr: 0, counterOrders: 0, counterRevenueIdr: 0, cancelledOrders: 0, deliveredOrders: 0, ...o,
});

const REG = Object.fromEntries(['C-01', 'P-01', 'P-05', 'P-08', 'H-01', 'K-01', 'S-01', 'meta.scope'].map((k) => [k, 1]));

describe('split helpers', () => {
  it('lists exactly the scalar depot sums', () => {
    expect([...SPLITTABLE_METRICS].sort()).toEqual(['G-01', 'P-01', 'P-04', 'P-07', 'P-10', 'T-01', 'T-02', 'T-03', 'U-02', 'U-04', 'U-05']);
  });

  it('wantsSplit: absent = no, depot = yes, anything else = 400', () => {
    expect(wantsSplit({})).toBe(false);
    expect(wantsSplit({ split: 'depot' })).toBe(true);
    expect(() => wantsSplit({ split: 'city' })).toThrow(BadRequestException);
  });

  it('assertSplittable refuses a metric that is not a depot sum, and does nothing without split', () => {
    expect(() => assertSplittable('C-01', {}, REG)).not.toThrow();
    expect(() => assertSplittable('P-01', { split: 'depot' }, REG)).not.toThrow();
    for (const id of ['C-01', 'P-05', 'P-08', 'H-01', 'K-01', 'S-01', 'meta.scope']) {
      expect(() => assertSplittable(id, { split: 'depot' }, REG)).toThrow(BadRequestException);
    }
  });

  it('an id outside the group is left to the service (404), split or not', () => {
    expect(() => assertSplittable('P-99', { split: 'depot' }, REG)).not.toThrow();
  });

  it('splitByDepot keeps a row of a depot outside the list in the total, and needs no rounding', () => {
    expect(splitByDepot([D1], [{ depotId: D2, v: 2 }], (r) => r.v)).toEqual({ total: 2, byDepot: [{ depotId: D1, value: 0 }, { depotId: D2, value: 2 }] });
  });

  it('splitByDepot lists a depot without rows as 0 and rounds the total and each depot', () => {
    const s = splitByDepot([D1, D2], [{ depotId: D1, v: 1.4 }, { depotId: D1, v: 1.4 }], (r) => r.v, Math.round);
    expect(s).toEqual({ total: 3, byDepot: [{ depotId: D1, value: 3 }, { depotId: D2, value: 0 }] });
  });
});

describe('money split', () => {
  const build = (scope: ReadScope = MID) => {
    const sources = {
      salesSummary: jest.fn(async (ids: string[]): Promise<DepotSalesRow[] | null> =>
        ids.map((d) => (d === D1 ? sale(d, { orders: 8, revenueIdr: 800_000.4, shippingIdr: 40_000, deliveredOrders: 6 }) : sale(d, { orders: 2, revenueIdr: 200_000, shippingIdr: 10_000, deliveredOrders: 1 })))),
    };
    const service = new MoneyMetricsService(
      { resolve: jest.fn(async () => scope) } as unknown as ReadScopeService,
      sources as never,
      {} as never,
      {} as never,
    );
    return { sources, ask: (id: string, q: Record<string, string> = NOVEMBER) => service.answer(id, user, q, NOW) };
  };

  it.each([
    ['P-01', 1_000_000, [800_000, 200_000]],
    ['P-04', 10, [8, 2]],
    ['P-07', 7, [6, 1]],
    ['P-10', 50_000, [40_000, 10_000]],
  ])('%s: total equals the unsplit answer, each depot once', async (id, total, per) => {
    const { ask } = build();
    const plain = await ask(id);
    const split = await ask(id, { ...NOVEMBER, split: 'depot' });
    expect(plain.value).toBe(total);
    expect(split.status).toBe('ok');
    expect(split.value).toEqual({ total: plain.value, byDepot: [{ depotId: D1, value: per[0] }, { depotId: D2, value: per[1] }] });
  });

  it('counts a depot readable from mid-period only for those days (same stretch reads as the total)', async () => {
    const { ask, sources } = build();
    await ask('P-01', { ...NOVEMBER, split: 'depot' });
    // one read per stretch, never one per depot
    expect(sources.salesSummary).toHaveBeenCalledTimes(2);
    expect(sources.salesSummary).toHaveBeenCalledWith([D2], { from: '2026-11-15T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' });
  });

  it('is belum_ada when the source is down: never a partial list', async () => {
    const { ask, sources } = build();
    sources.salesSummary.mockResolvedValue(null);
    const a = await ask('P-01', { ...NOVEMBER, split: 'depot' });
    expect(a).toMatchObject({ status: 'belum_ada', value: null });
  });

  it('a depot with no orders is a real 0', async () => {
    const { ask, sources } = build();
    sources.salesSummary.mockResolvedValue([]);
    expect((await ask('P-04', { ...NOVEMBER, split: 'depot' })).value).toEqual({ total: 0, byDepot: [{ depotId: D1, value: 0 }, { depotId: D2, value: 0 }] });
  });

  it('a month metric needs the whole month: a depot readable only to the 15th is not enough (not split, but its edge)', async () => {
    const { ask } = build(scopeOf([span(D1, '2026-11-01', '2026-11-15')]));
    expect(await ask('L-07')).toMatchObject({ status: 'belum_ada' });
  });

  it('refuses a bad split value', async () => {
    await expect(build().ask('P-01', { ...NOVEMBER, split: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('gallon split', () => {
  const build = (scope: ReadScope = MID) => {
    const sources = {
      // D2 sold nothing: it is absent from the source's answer and must be listed as 0
      gallonsSold: jest.fn(async (): Promise<{ gallons: number; byDepot: { depotId: string; gallons: number }[] | null } | null> => ({ gallons: 30, byDepot: [{ depotId: D1, gallons: 30 }] })),
    };
    const service = new GallonMetricsService({ resolve: jest.fn(async () => scope) } as unknown as ReadScopeService, {} as never, sources as never);
    return { sources, ask: (q: Record<string, string> = NOVEMBER) => service.answer('G-01', user, q, NOW) };
  };

  it('is ONE source read for all depots, and lists a depot that sold nothing as 0', async () => {
    const { ask, sources } = build();
    const a = await ask({ ...NOVEMBER, split: 'depot' });
    expect(a.value).toEqual({ total: 30, byDepot: [{ depotId: D1, value: 30 }, { depotId: D2, value: 0 }] });
    expect(sources.gallonsSold).toHaveBeenCalledTimes(1);
    expect(sources.gallonsSold).toHaveBeenCalledWith([
      expect.objectContaining({ depotId: D1 }),
      expect.objectContaining({ depotId: D2, from: '2026-11-15T17:00:00.000Z' }),
    ]);
  });

  it('is belum_ada when the source is down', async () => {
    const { ask, sources } = build();
    sources.gallonsSold.mockResolvedValue(null);
    expect(await ask({ ...NOVEMBER, split: 'depot' })).toMatchObject({ status: 'belum_ada', value: null });
  });

  it('is belum_ada, with no second read, when order-service answers no per-depot list yet', async () => {
    const { ask, sources } = build();
    sources.gallonsSold.mockResolvedValue({ gallons: 30, byDepot: null });
    expect(await ask({ ...NOVEMBER, split: 'depot' })).toMatchObject({ status: 'belum_ada', value: null });
    expect(sources.gallonsSold).toHaveBeenCalledTimes(1);
    // the unsplit answer still works against the older order-service
    expect((await ask()).value).toBe(30);
  });
});
