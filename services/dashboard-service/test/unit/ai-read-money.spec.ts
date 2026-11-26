import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { MONEY_METRIC_IDS, MONEY_METRICS, MoneyMetricsService } from '../../src/application/ai-read/money-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import {
  AiMoneySourcesPort,
  DepotMoneyRow,
  DepotSalesRow,
  ProductRow,
  ShiftVariance,
  TimeAreaRows,
} from '../../src/application/ports/ai-money-sources.port';
import { DashboardSourcesPort } from '../../src/application/ports/dashboard-sources.port';
import { DashboardService } from '../../src/application/services/dashboard.service';

/*
 * HD-6 H2: the money metrics. The sources and the P&L are stubbed; what is under test is what the
 * metric does with them: the formula, the stretch of days each depot may be read for, the WIB
 * instants asked for, and when it says belum_ada or ditahan instead of a number.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-25T03:00:00.000Z');
const NOVEMBER = { period: 'month', date: '2026-11-10' };
const NOV_FROM = '2026-10-31T17:00:00.000Z';
const NOV_TO = '2026-11-30T17:00:00.000Z';
// D1 moves from PT_A to PT_B on 16 Nov: 15 Nov 23:59 WIB is PT_A's, 16 Nov 00:00 WIB is PT_B's.
const MID_FROM = '2026-11-15T17:00:00.000Z';

const user = (role: string): AuthenticatedUser => ({ sub: 'u1', role, depotId: null }) as unknown as AuthenticatedUser;
const span = (depotId: string, from: string, to: string, legalEntityId: string | null = PT_A) => ({ depotId, legalEntityId, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: {
    depotIds: [...new Set(spans.map((s) => s.depotId))].sort(),
    legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
  },
});
const WHOLE = scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-01', '2026-11-30', PT_B)]);

const sale = (depotId: string, o: Partial<DepotSalesRow> = {}): DepotSalesRow => ({
  depotId,
  orders: 0,
  revenueIdr: 0,
  shippingIdr: 0,
  appOrders: 0,
  appRevenueIdr: 0,
  counterOrders: 0,
  counterRevenueIdr: 0,
  cancelledOrders: 0,
  deliveredOrders: 0,
  ...o,
});
const money = (o: Partial<DepotMoneyRow>): DepotMoneyRow => ({
  depotId: D1,
  channel: 'counter',
  method: 'CASH',
  amountIdr: 0,
  count: 0,
  ...o,
});

function build(scope: ReadScope = WHOLE) {
  const sources = {
    salesSummary: jest.fn(async (): Promise<DepotSalesRow[] | null> => [
      sale(D1, { orders: 8, revenueIdr: 800_000, shippingIdr: 40_000, appOrders: 5, appRevenueIdr: 600_000, counterOrders: 3, counterRevenueIdr: 200_000, cancelledOrders: 2, deliveredOrders: 6 }),
      sale(D2, { orders: 2, revenueIdr: 200_000, shippingIdr: 10_000, appOrders: 2, appRevenueIdr: 200_000, deliveredOrders: 1 }),
    ]),
    productRevenue: jest.fn(async (): Promise<ProductRow[] | null> => [
      { productId: 'p1', productName: 'Galon isi ulang', orders: 6, revenueIdr: 600_000 },
      { productId: 'p2', productName: 'Air kemasan', orders: 2, revenueIdr: 100_000 },
    ]),
    timeArea: jest.fn(async (): Promise<TimeAreaRows | null> => ({
      heat: [[1, 2], [3, 4]],
      byWeekday: [{ weekday: 1, orders: 3, revenueIdr: 300_000 }],
      byArea: [{ area: 'Bekasi', orders: 3, revenueIdr: 300_000 }],
      otherAreas: { orders: 1, revenueIdr: 10_000 },
    })),
    money: jest.fn(async (kind: string): Promise<DepotMoneyRow[] | null> => {
      if (kind === 'refunded') {
        return [money({ orderId: 'o1', amountIdr: 15_000 }), money({ orderId: 'o2', amountIdr: 7_000 })];
      }
      if (kind === 'pending') {
        return [money({ channel: 'delivery', method: 'CASH', age: '0-1', amountIdr: 50_000, count: 1 }), money({ method: 'QRIS', age: '8+', amountIdr: 20_000, count: 2 })];
      }
      return [
        money({ channel: 'delivery', amountIdr: 100_000, count: 2 }),
        money({ channel: 'counter', amountIdr: 60_000, count: 3 }),
        money({ channel: 'counter', method: 'QRIS', amountIdr: 40_000, count: 1 }),
      ];
    }),
    countingOrders: jest.fn(async () => new Set(['o1'])),
    cashbookCosts: jest.fn(async () => ({ cogsIdr: 1_000, opexIdr: 300 })),
    daysClosed: jest.fn(async () => 20),
    codPeriod: jest.fn(async () => ({ depositedIdr: 90_000, expectedIdr: 100_000, shortfallIdr: 15_000, surplusIdr: 5_000, undepositedIdr: 30_000 })),
    shiftVariance: jest.fn(async (): Promise<ShiftVariance | null> => ({ shifts: 3, shortfallIdr: 8_000, surplusIdr: 2_000 })),
    cashFlow: jest.fn(async (): Promise<{ netCashFlowIdr: number | null } | null> => ({ netCashFlowIdr: 500 })),
  };
  const sourcesPort = sources as unknown as AiMoneySourcesPort;
  const depots = {
    // every depot's month is finished: slips exist and none is DRAFT
    hrSummaryMany: jest.fn(async (ids: string[]) => ids.map((depotId) => ({ depotId, payrollCount: 3, payrollDraftCount: 0, payrollFinalCount: 3, payrollExpectedCount: 3, activeHeadcount: 3 }))),
    payoutCosts: jest.fn(async (ids: string[]) => new Map(ids.map((d) => [d, { commissionIdr: 1_000, expenseClaimIdr: 200 }]))),
  };
  const row = (depotId: string) => ({ depotId });
  const dashboard = {
    networkPnl: jest.fn(async (_m: string, _t: string, ids: readonly string[]) => ({
      depots: ids.map(row),
      sources: { depot: 'ok' },
      totals: { revenueIdr: 1_000_000, cogsIdr: 400_000, payrollIdr: 200_000, courierCommissionIdr: 50_000, expenseClaimIdr: 10_000, refundIdr: 15_000, netProfitIdr: 325_000 },
    })),
  };
  const scopes = { resolve: jest.fn(async () => scope) } as unknown as ReadScopeService;
  const service = new MoneyMetricsService(
    scopes,
    sourcesPort,
    depots as unknown as DashboardSourcesPort,
    dashboard as unknown as DashboardService,
  );
  const ask = (id: string, role = 'SUPER_ADMIN', query: Record<string, string> = NOVEMBER) =>
    service.answer(id, user(role), query, NOW);
  return { sources, depots, dashboard, ask };
}

describe('MoneyMetricsService: sales (3.1)', () => {
  it('works the dictionary formulas out of the per-depot rows', async () => {
    const { ask } = build();
    expect((await ask('P-01')).value).toBe(1_000_000);
    expect((await ask('P-04')).value).toBe(10);
    expect((await ask('P-05')).value).toBe(100_000);
    expect((await ask('P-06')).value).toEqual({ cancelled: 2, ratePct: 16.7 });
    expect((await ask('P-07')).value).toBe(7);
    expect((await ask('P-08')).value).toEqual({
      app: { orders: 7, revenueIdr: 800_000 },
      counter: { orders: 3, revenueIdr: 200_000 },
    });
    expect((await ask('P-10')).value).toBe(50_000);
    const p01 = await ask('P-01');
    expect(p01).toMatchObject({ metricId: 'P-01', status: 'ok', unit: 'Rp', period: { from: '2026-11-01', to: '2026-11-30' } });
    expect(typeof p01.value).toBe('number');
  });

  it('counts only refunds of orders that still count, and sets the rest apart (P-02), then nets it off P-01 (P-03)', async () => {
    const { ask, sources } = build();
    expect((await ask('P-02')).value).toEqual({ refundIdr: 15_000, refundOfCancelledAndVoidOrdersIdr: 7_000 });
    expect(sources.countingOrders).toHaveBeenCalledWith(['o1', 'o2']);
    expect((await ask('P-03')).value).toBe(985_000);
  });

  it('lists the top products and merges a product that appears in two stretches', async () => {
    const mid = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D1, '2026-11-16', '2026-11-30', PT_B), span(D2, '2026-11-01', '2026-11-30')]);
    const { ask, sources } = build(mid);
    const answer = await ask('P-09');
    // D1 twice (two stretches share no key with D2's) and D2 once: three reads, products added up
    expect(sources.productRevenue).toHaveBeenCalledTimes(3);
    expect(answer.value).toEqual([
      { label: 'Galon isi ulang', orders: 18, revenueIdr: 1_800_000 },
      { label: 'Air kemasan', orders: 6, revenueIdr: 300_000 },
    ]);
  });

  it('ranks products only AFTER merging the stretches: an item small in each stretch can still make the top ten', async () => {
    const two = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D2, '2026-11-01', '2026-11-30')]);
    const { ask, sources } = build(two);
    // 'Kecil' is 11th in each stretch (a per-stretch top ten would drop it twice) but adds up to the
    // biggest once both stretches are merged.
    const stretch = (big: number) => [
      ...Array.from({ length: 10 }, (_, i) => ({ productId: `b${i}`, productName: `Besar ${i}`, orders: 1, revenueIdr: big + i })),
      { productId: 'k', productName: 'Kecil', orders: 1, revenueIdr: 99 },
    ];
    sources.productRevenue.mockResolvedValueOnce(stretch(100)).mockResolvedValueOnce(stretch(1));
    const top = (await ask('P-09')).value as { label: string; revenueIdr: number }[];
    expect(top).toHaveLength(10);
    expect(top.find((p) => p.label === 'Kecil')?.revenueIdr).toBe(198);
    expect(top[0].label).toBe('Kecil');
  });

  it('ranks cities only after merging too: a city small in each stretch survives into the top ten', async () => {
    const two = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D2, '2026-11-01', '2026-11-30')]);
    const { ask, sources } = build(two);
    const cities = (n: number) => [
      ...Array.from({ length: 10 }, (_, i) => ({ area: `Kota ${i}`, orders: n + i, revenueIdr: 1 })),
      { area: 'Kecil', orders: n + 9, revenueIdr: 1 },
    ];
    const mk = (n: number) => ({ heat: [], byWeekday: [{ weekday: 1, orders: 1, revenueIdr: 1 }], byArea: cities(n), otherAreas: null });
    sources.timeArea.mockResolvedValueOnce(mk(1)).mockResolvedValueOnce(mk(1));
    const v = (await ask('P-13')).value as { byArea: { label: string; orders: number }[]; otherAreas: { orders: number } };
    expect(v.byArea).toHaveLength(10);
    expect(v.byArea.find((a) => a.label === 'Kecil')?.orders).toBe(20);
    // the one city that fell out is counted in otherAreas, not lost
    expect(v.otherAreas.orders).toBe(2);
  });

  it('merges time and area across stretches, with the other cities counted apart', async () => {
    const { ask } = build();
    expect((await ask('P-13')).value).toEqual({
      heat: [[1, 2], [3, 4]],
      byWeekday: [{ weekday: 1, orders: 3, revenueIdr: 300_000 }],
      byArea: [{ label: 'Bekasi', orders: 3, revenueIdr: 300_000 }],
      otherAreas: { orders: 1, revenueIdr: 10_000 },
    });
  });

  it('keeps the ten biggest cities, ties by name, the weekdays in order, and counts the rest as other', async () => {
    const { ask, sources } = build();
    sources.timeArea.mockResolvedValue({
      heat: [],
      byWeekday: [
        { weekday: 3, orders: 1, revenueIdr: 1 },
        { weekday: 1, orders: 1, revenueIdr: 1 },
      ],
      byArea: Array.from({ length: 12 }, (_, i) => ({ area: `Kota ${String.fromCharCode(76 - i)}`, orders: 1, revenueIdr: 10 })),
      otherAreas: null,
    });
    const v = (await ask('P-13')).value as {
      byWeekday: { weekday: number }[];
      byArea: { label: string }[];
      otherAreas: { orders: number; revenueIdr: number };
    };
    expect(v.byWeekday.map((w) => w.weekday)).toEqual([1, 3]);
    expect(v.byArea).toHaveLength(10);
    expect(v.byArea[0].label).toBe('Kota A');
    expect(v.otherAreas).toEqual({ orders: 2, revenueIdr: 20 });
  });

  it('says belum_ada, not 0, when there are no orders to average or rate', async () => {
    const { ask, sources } = build();
    sources.salesSummary.mockResolvedValue([]);
    expect((await ask('P-01')).value).toBe(0);
    for (const id of ['P-05', 'P-06', 'P-08']) expect(await ask(id)).toMatchObject({ status: 'belum_ada', value: null });
    sources.productRevenue.mockResolvedValue([]);
    expect(await ask('P-09')).toMatchObject({ status: 'belum_ada' });
    sources.timeArea.mockResolvedValue({ heat: [], byWeekday: [], byArea: [], otherAreas: null });
    expect(await ask('P-13')).toMatchObject({ status: 'belum_ada' });
  });

  it('says belum_ada when a source cannot answer', async () => {
    const { ask, sources } = build();
    sources.salesSummary.mockResolvedValue(null);
    sources.productRevenue.mockResolvedValue(null);
    sources.timeArea.mockResolvedValue(null);
    for (const id of ['P-01', 'P-03', 'P-04', 'P-09', 'P-13']) {
      expect(await ask(id)).toMatchObject({ status: 'belum_ada', value: null });
    }
    sources.money.mockResolvedValue(null);
    expect(await ask('P-02')).toMatchObject({ status: 'belum_ada' });
    sources.money.mockImplementation(async () => [money({ orderId: 'o1', amountIdr: 1 })]);
    sources.countingOrders.mockResolvedValue(null as never);
    expect(await ask('P-02')).toMatchObject({ status: 'belum_ada' });
  });

  it('answers the unbuilt and the held ones without calling a source', async () => {
    const { ask, sources } = build();
    expect(await ask('P-11')).toMatchObject({ status: 'belum_ada', value: null });
    expect(await ask('U-03')).toMatchObject({ status: 'belum_ada', value: null });
    expect(await ask('P-14')).toMatchObject({ status: 'ditahan', value: null });
    expect(sources.salesSummary).not.toHaveBeenCalled();
  });
});

describe('MoneyMetricsService: scope and the WIB window', () => {
  it('asks each source for the WIB month as instants, for the depots in scope only', async () => {
    const { ask, sources } = build();
    await ask('P-01');
    expect(sources.salesSummary).toHaveBeenCalledWith([D1, D2], { from: NOV_FROM, to: NOV_TO });
  });

  it('reads a depot that changed entity mid-month only for the days it was readable', async () => {
    // The role may read PT_B only: D1 counts from 16 Nov 00:00 WIB, D2 all month.
    const scope = scopeOf([span(D1, '2026-11-16', '2026-11-30', PT_B), span(D2, '2026-11-01', '2026-11-30', PT_B)]);
    const { ask, sources } = build(scope);
    const answer = await ask('P-01');
    expect(sources.salesSummary).toHaveBeenCalledWith([D1], { from: MID_FROM, to: NOV_TO });
    expect(sources.salesSummary).toHaveBeenCalledWith([D2], { from: NOV_FROM, to: NOV_TO });
    expect(sources.salesSummary).toHaveBeenCalledTimes(2);
    expect(answer.scope.depotIds).toEqual([D1, D2]);
  });

  it('reads two stretches of one depot as two windows (entity changed, both readable)', async () => {
    const scope = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D1, '2026-11-16', '2026-11-30', PT_B)]);
    const { ask, sources } = build(scope);
    await ask('P-01');
    expect(sources.salesSummary).toHaveBeenCalledWith([D1], { from: NOV_FROM, to: MID_FROM });
    expect(sources.salesSummary).toHaveBeenCalledWith([D1], { from: MID_FROM, to: NOV_TO });
  });

  it('reads 100 depots at a time', async () => {
    const many = Array.from({ length: 101 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-11-01', '2026-11-30'));
    const { ask, sources } = build(scopeOf(many));
    await ask('P-01');
    expect(sources.salesSummary.mock.calls.map((c) => (c as unknown as [string[]])[0].length)).toEqual([100, 1]);
  });

  it('answers belum_ada when nothing is readable, and 404 for an id outside the dictionary', async () => {
    const { ask } = build(scopeOf([]));
    expect(await ask('P-01')).toMatchObject({ status: 'belum_ada', value: null });
    await expect(build().ask('P-99')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build().ask('constructor')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps a month-only metric to one whole month', async () => {
    const { ask } = build();
    await expect(ask('L-07', 'SUPER_ADMIN', { from: '2026-11-05', to: '2026-11-20' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ask('L-07', 'SUPER_ADMIN', { from: '2026-10-01', to: '2026-11-30' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await ask('L-07', 'SUPER_ADMIN', { from: '2026-11-01', to: '2026-11-30' })).toMatchObject({ status: 'ok' });
    // a named day or week, even inside one month, is not a month: it used to answer the WHOLE month's figure
    for (const id of ['L-01', 'L-03', 'L-06', 'L-07', 'L-08', 'L-09', 'U-07']) {
      for (const q of [{ period: 'week', date: '2026-11-10' }, { period: 'day', date: '2026-11-10' }, { period: 'year', date: '2026-11-10' }]) {
        await expect(ask(id, 'SUPER_ADMIN', q)).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await ask(id, 'SUPER_ADMIN', { period: 'month', date: '2026-11-10' })).toBeDefined();
    }
    // a free range is fine for a metric that is not monthly
    expect(await ask('P-01', 'SUPER_ADMIN', { from: '2026-11-05', to: '2026-11-20' })).toMatchObject({ status: 'ok' });
  });
});

describe('MoneyMetricsService: cash and COD (3.3)', () => {
  it('U-01 collected by method; U-05 counter cash only; U-04 the three COD numbers', async () => {
    const { ask } = build();
    expect((await ask('U-01')).value).toEqual({
      totalIdr: 200_000,
      byMethod: { CASH: { amountIdr: 160_000, count: 5 }, QRIS: { amountIdr: 40_000, count: 1 } },
    });
    expect((await ask('U-05')).value).toEqual({
      cashIdr: 60_000,
      shiftVariance: { shifts: 6, shortfallIdr: 16_000, surplusIdr: 4_000 },
    });
    // two depots, one stretch: deposited and expected are summed over both depots
    expect((await ask('U-04')).value).toEqual({
      collectedIdr: 100_000,
      depositedIdr: 180_000,
      undepositedIdr: 60_000,
      expectedIdr: 200_000,
      shortfallIdr: 30_000,
      surplusIdr: 10_000,
    });
    expect((await ask('P-02')).label).toContain('batal dan void');
    // each COD figure says which depot it follows
    expect((await ask('U-04')).label).toContain('depot PESANAN');
    expect((await ask('U-04')).label).toContain('depot SHIFT kurir');
  });

  it('U-05 says a till-shift variance it cannot read is belum_ada inside the answer, not left out', async () => {
    const { ask, sources } = build();
    sources.shiftVariance.mockResolvedValue(null);
    const v = (await ask('U-05')).value as { cashIdr: number; shiftVariance: { status: string } };
    expect(v.cashIdr).toBe(60_000);
    expect(v.shiftVariance.status).toBe('belum_ada');
  });

  it('says how many paid orders have no depot and how much, and that they are not counted (N2)', async () => {
    const { ask, sources } = build();
    const withUnplaced = (rows: DepotMoneyRow[]) => Object.assign(rows, { unplaced: { orders: 2, amountIdr: 125_000 } });
    sources.money.mockImplementation((async (kind: string) =>
      withUnplaced(kind === 'refunded' ? [money({ orderId: 'o1', amountIdr: 15_000 })] : [money({ channel: 'delivery', amountIdr: 100_000, count: 1 })])) as never);
    for (const id of ['U-01', 'U-02', 'U-04', 'U-05', 'P-02', 'P-03']) {
      expect((await ask(id)).label).toContain('2 pesanan tanpa depot (Rp 125.000) tidak dihitung');
    }
    // nothing unplaced: no note
    sources.money.mockImplementation((async () => [money({ amountIdr: 1 })]) as never);
    expect((await ask('U-01')).label).not.toContain('tanpa depot');
  });

  it('counts the unplaced orders once per stretch, not once per 100-depot chunk', async () => {
    const many = Array.from({ length: 101 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-11-01', '2026-11-30'));
    const { ask, sources } = build(scopeOf(many));
    sources.money.mockImplementation((async () => Object.assign([money({ amountIdr: 1 })], { unplaced: { orders: 3, amountIdr: 9_000 } })) as never);
    expect((await ask('U-01')).label).toContain('3 pesanan tanpa depot (Rp 9.000) tidak dihitung');
  });

  it('U-02 pending money by method and age', async () => {
    const { ask } = build();
    expect((await ask('U-02')).value).toEqual({
      totalIdr: 70_000,
      count: 3,
      byMethod: { CASH: { amountIdr: 50_000, count: 1 }, QRIS: { amountIdr: 20_000, count: 2 } },
      byAge: { '0-1': { amountIdr: 50_000, count: 1 }, '8+': { amountIdr: 20_000, count: 2 } },
    });
  });

  describe('split=depot on the cash figures (AI-31)', () => {
    const SPLIT = { ...NOVEMBER, split: 'depot' };
    const withCodes = (b: ReturnType<typeof build>, rows: Array<{ id: string; code: string }> | null = [{ id: D1, code: 'JKT-01' }, { id: D2, code: 'BKS-02' }]) => {
      (b.depots as unknown as { allDepots: jest.Mock }).allDepots = jest.fn(async () => rows);
      return b;
    };

    it('U-02: total is the unsplit answer, every depot once with its code, an empty depot a real zero', async () => {
      const { ask } = withCodes(build());
      const plain = await ask('U-02');
      const split = (await ask('U-02', 'SUPER_ADMIN', SPLIT)).value as { total: unknown; byDepot: Array<{ depotId: string; code: string; value: { totalIdr: number; count: number } }> };
      expect(split.total).toEqual(plain.value);
      expect(split.byDepot.map((d) => [d.depotId, d.code])).toEqual([[D1, 'JKT-01'], [D2, 'BKS-02']]);
      expect(split.byDepot[0].value).toEqual(plain.value);
      expect(split.byDepot[1].value).toEqual({ totalIdr: 0, count: 0, byMethod: {}, byAge: {} });
    });

    it('U-04 and U-05: each depot carries its own shift and COD reads, the total adds them up', async () => {
      const b = withCodes(build());
      b.sources.codPeriod.mockImplementation((async (d: string) => ({ depositedIdr: d === D1 ? 70_000 : 20_000, expectedIdr: 100_000, shortfallIdr: 0, surplusIdr: 0, undepositedIdr: 0 })) as never);
      b.sources.shiftVariance.mockImplementation((async (d: string) => ({ shifts: d === D1 ? 5 : 1, shortfallIdr: 0, surplusIdr: 0 })) as never);
      const cod = (await b.ask('U-04', 'SUPER_ADMIN', SPLIT)).value as { total: { depositedIdr: number }; byDepot: Array<{ value: { depositedIdr: number; collectedIdr: number } }> };
      expect(cod.total.depositedIdr).toBe(90_000);
      expect(cod.byDepot.map((d) => d.value.depositedIdr)).toEqual([70_000, 20_000]);
      expect(cod.byDepot.map((d) => d.value.collectedIdr)).toEqual([100_000, 0]);
      const till = (await b.ask('U-05', 'SUPER_ADMIN', SPLIT)).value as { total: { shiftVariance: { shifts: number } }; byDepot: Array<{ value: { cashIdr: number; shiftVariance: { shifts: number } } }> };
      expect(till.total.shiftVariance.shifts).toBe(6);
      expect(till.byDepot.map((d) => d.value.shiftVariance.shifts)).toEqual([5, 1]);
      expect(till.byDepot.map((d) => d.value.cashIdr)).toEqual([60_000, 0]);
    });

    it('U-05: a shift source that cannot answer says so inside every depot, never 0', async () => {
      const b = withCodes(build());
      b.sources.shiftVariance.mockResolvedValue(null);
      const till = (await b.ask('U-05', 'SUPER_ADMIN', SPLIT)).value as { byDepot: Array<{ value: { shiftVariance: { status: string } } }> };
      expect(till.byDepot.map((d) => d.value.shiftVariance.status)).toEqual(['belum_ada', 'belum_ada']);
    });

    it('names no code it cannot: depot-service down, an unknown depot, or a code that reads as a phone number', async () => {
      const down = withCodes(build(), null);
      const a = (await down.ask('U-02', 'SUPER_ADMIN', SPLIT)).value as { byDepot: Array<{ code: string | null }> };
      expect(a.byDepot.map((d) => d.code)).toEqual([null, null]);
      const odd = withCodes(build(), [{ id: D1, code: '081234567890' }]);
      const b = (await odd.ask('U-02', 'SUPER_ADMIN', SPLIT)).value as { byDepot: Array<{ code: string | null }> };
      expect(b.byDepot.map((d) => d.code)).toEqual([null, null]);
    });

    it('stays belum_ada when a source is down: never a partial list', async () => {
      const b = withCodes(build());
      b.sources.codPeriod.mockResolvedValue(null as never);
      expect(await b.ask('U-04', 'SUPER_ADMIN', SPLIT)).toMatchObject({ status: 'belum_ada', value: null });
    });
  });

  it('U-06 / L-02 cashbook costs and U-07 closed days, summed over the depots', async () => {
    const { ask } = build();
    expect((await ask('U-06')).value).toBe(600);
    expect((await ask('L-02')).value).toBe(2_000);
    expect((await ask('U-07')).value).toBe(40);
  });

  it('says belum_ada when a source is down, and when a metric would need too many one-depot reads', async () => {
    const { ask, sources } = build();
    sources.money.mockResolvedValue(null);
    for (const id of ['U-01', 'U-02', 'U-04', 'U-05']) expect(await ask(id)).toMatchObject({ status: 'belum_ada' });
    sources.money.mockResolvedValue([money({ channel: 'delivery', amountIdr: 1 })]);
    sources.codPeriod.mockResolvedValue(null as never);
    expect(await ask('U-04')).toMatchObject({ status: 'belum_ada' });
    sources.cashbookCosts.mockResolvedValue(null as never);
    sources.daysClosed.mockResolvedValue(null as never);
    expect(await ask('U-06')).toMatchObject({ status: 'belum_ada' });
    expect(await ask('U-07')).toMatchObject({ status: 'belum_ada' });

    const many = Array.from({ length: 301 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-11-01', '2026-11-30'));
    const big = build(scopeOf(many));
    expect(await big.ask('U-06')).toMatchObject({ status: 'belum_ada', value: null });
    expect(big.sources.cashbookCosts).not.toHaveBeenCalled();
  });
});

describe('MoneyMetricsService: profit and loss (3.4)', () => {
  it('reuses the network P&L: totals, never a second formula', async () => {
    const { ask, dashboard } = build();
    expect((await ask('L-01')).value).toBe(400_000);
    expect((await ask('L-06')).value).toBe(600_000);
    expect((await ask('L-03')).value).toBe(200_000);
    expect((await ask('L-07')).value).toBe(325_000);
    expect((await ask('L-08')).value).toBe(32.5);
    expect(dashboard.networkPnl).toHaveBeenCalledWith('2026-11', '', [D1, D2], true);
  });

  it('labels the payroll as base pay and allowances, and the profit as the 17 Nov formula', async () => {
    const { ask } = build();
    expect((await ask('L-03')).label).toBe('gaji pokok dan tunjangan, belum termasuk bonus, lembur, THR dan BPJS perusahaan');
    expect((await ask('L-08')).label).toContain('belum termasuk bonus, lembur, THR dan BPJS perusahaan');
    expect((await ask('L-07')).label).toContain('17 Nov');
    expect((await ask('L-07')).label).toContain('kas keluar di luar rumus');
  });

  it('L-04 / L-05 courier commission and claims by the readable stretches', async () => {
    const { ask, depots } = build();
    expect((await ask('L-04')).value).toBe(2_000);
    expect((await ask('L-05')).value).toBe(400);
    expect(depots.payoutCosts).toHaveBeenCalledWith([D1, D2], { from: NOV_FROM, to: NOV_TO });
  });

  it('leaves a depot that changed entity mid-month out of a whole-month figure, and echoes who was counted', async () => {
    const scope = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D1, '2026-11-16', '2026-11-30', PT_B), span(D2, '2026-11-01', '2026-11-30', PT_B)]);
    const { ask, dashboard } = build(scope);
    const answer = await ask('L-07');
    expect(dashboard.networkPnl).toHaveBeenCalledWith('2026-11', '', [D2], true);
    expect(answer.scope).toEqual({ depotIds: [D2], legalEntityIds: [PT_B] });
    const onlyPartial = build(scopeOf([span(D1, '2026-11-16', '2026-11-30', PT_B)]));
    expect(await onlyPartial.ask('L-07')).toMatchObject({ status: 'belum_ada', value: null });
    expect(await onlyPartial.ask('L-09')).toMatchObject({ status: 'belum_ada', value: null });
  });

  it('is belum_ada for an element the P&L could not read, never 0', async () => {
    const { ask, dashboard } = build();
    const totals = { revenueIdr: 1_000_000, cogsIdr: null, payrollIdr: null, courierCommissionIdr: 0, expenseClaimIdr: 0, refundIdr: 0, netProfitIdr: null };
    dashboard.networkPnl.mockImplementation((async (_m: string, _t: string, ids: readonly string[]) => ({ depots: ids.map((depotId) => ({ depotId })), sources: { depot: 'ok' }, totals })) as never);
    for (const id of ['L-01', 'L-03', 'L-06', 'L-07', 'L-08']) {
      expect(await ask(id)).toMatchObject({ status: 'belum_ada', value: null });
    }
    // no revenue: no margin
    totals.netProfitIdr = 0 as never;
    totals.revenueIdr = 0;
    expect(await ask('L-08')).toMatchObject({ status: 'belum_ada' });
  });

  it('does not hide a real failure behind belum_ada', async () => {
    const { ask, dashboard } = build();
    dashboard.networkPnl.mockRejectedValue(new Error('boom'));
    await expect(ask('L-07')).rejects.toThrow('boom');
  });

  it('is belum_ada when the depot list or a depot row did not come back', async () => {
    const { ask, dashboard } = build();
    dashboard.networkPnl.mockImplementation((async () => ({ depots: [], sources: { depot: 'unavailable' }, totals: {} })) as never);
    expect(await ask('L-07')).toMatchObject({ status: 'belum_ada' });
    dashboard.networkPnl.mockImplementation((async () => ({ depots: [{ depotId: D1 }], sources: { depot: 'ok' }, totals: {} })) as never);
    expect(await ask('L-07')).toMatchObject({ status: 'belum_ada' });
  });

  it('holds payroll-bearing figures back from a role that may not read payroll', async () => {
    const { ask, dashboard, sources } = build();
    for (const id of ['L-03', 'L-07', 'L-08', 'L-09']) {
      expect(await ask(id, 'FINANCE_STAFF_WITHOUT_PAYROLL')).toMatchObject({ status: 'ditahan', value: null });
    }
    expect(dashboard.networkPnl).not.toHaveBeenCalled();
    expect(sources.cashFlow).not.toHaveBeenCalled();
    // goods cost carries no payroll: still answered
    dashboard.networkPnl.mockClear();
    expect((await ask('L-01', 'FINANCE_STAFF_WITHOUT_PAYROLL')).status).toBe('ok');
    expect(dashboard.networkPnl).toHaveBeenCalledWith('2026-11', '', [D1, D2], false);
  });

  it('answers belum_ada for every payroll-bearing figure while a depot-month is not finished (choice 10A)', async () => {
    const { ask, depots, dashboard, sources } = build();
    const state = (rows: Record<string, unknown>[]) =>
      depots.hrSummaryMany.mockImplementation((async (ids: string[]) => ids.map((depotId, i) => ({ depotId, ...rows[i % rows.length] }))) as never);
    const done = { payrollCount: 3, payrollDraftCount: 0, payrollFinalCount: 3, payrollExpectedCount: 3 };
    for (const unfinished of [
      // a DRAFT slip in one depot
      [{ ...done, payrollDraftCount: 1, payrollFinalCount: 2 }, done],
      // nothing run yet for staff who are waiting
      [{ payrollCount: 0, payrollDraftCount: 0, payrollFinalCount: 0, payrollExpectedCount: 3 }],
      // 5 people employed in the month, 3 APPROVED slips and no DRAFT: two people are still missing
      [{ payrollCount: 3, payrollDraftCount: 0, payrollFinalCount: 3, payrollExpectedCount: 5 }],
    ]) {
      state(unfinished);
      for (const id of ['L-03', 'L-07', 'L-08', 'L-09']) {
        const a = await ask(id);
        expect(a).toMatchObject({ status: 'belum_ada', value: null });
        expect(a.reason).toContain('belum selesai');
      }
    }
    expect(dashboard.networkPnl).not.toHaveBeenCalled();
    expect(sources.cashFlow).not.toHaveBeenCalled();
    // HPP and gross profit carry no salary: still answered
    expect((await ask('L-01')).status).toBe('ok');
    // finished: everyone expected has an approved or paid slip. A mid-month joiner and a mid-month leaver
    // are both in `expected` (employed at some time in the month) and both have their slip; a leaver who
    // left before the month is not expected. A depot with nobody to pay is finished.
    state([
      { payrollCount: 5, payrollDraftCount: 0, payrollFinalCount: 5, payrollExpectedCount: 5 },
      { payrollCount: 0, payrollDraftCount: 0, payrollFinalCount: 0, payrollExpectedCount: 0 },
    ]);
    expect((await ask('L-07')).status).toBe('ok');
    expect((await ask('L-09')).status).toBe('ok');
    // more finished slips than the month expected (a lent-out person paid here) is still finished
    state([{ payrollCount: 4, payrollDraftCount: 0, payrollFinalCount: 4, payrollExpectedCount: 3 }]);
    expect((await ask('L-07')).status).toBe('ok');
    // an old hr-service that does not say, or one that cannot answer, is not "finished"
    depots.hrSummaryMany.mockImplementation((async (ids: string[]) => ids.map((depotId) => ({ depotId, payrollCount: 3, payrollDraftCount: 0, activeHeadcount: 3 }))) as never);
    expect(await ask('L-07')).toMatchObject({ status: 'belum_ada' });
    depots.hrSummaryMany.mockImplementation((async (ids: string[]) => ids.map(() => null)) as never);
    expect(await ask('L-03')).toMatchObject({ status: 'belum_ada' });
  });

  it('says HPP and gross profit of the running month are only as far as today, and a past month is not', async () => {
    const { ask } = build();
    for (const id of ['L-01', 'L-06']) {
      expect((await ask(id)).label).toContain('bulan berjalan, sampai 2026-11-25 (WIB)');
      const past = build(scopeOf([span(D1, '2026-10-01', '2026-10-31')]));
      expect((await past.ask(id, 'SUPER_ADMIN', { period: 'month', date: '2026-10-10' })).label).not.toContain('bulan berjalan');
    }
  });

  it('counts a depot covered all month by two contiguous rows as a whole month, but not one with a gap', async () => {
    const contiguous = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D1, '2026-11-16', '2026-11-30')]);
    const a = build(contiguous);
    expect((await a.ask('L-07')).scope.depotIds).toEqual([D1]);
    expect(a.dashboard.networkPnl).toHaveBeenCalledWith('2026-11', '', [D1], true);
    const gap = build(scopeOf([span(D1, '2026-11-01', '2026-11-14'), span(D1, '2026-11-16', '2026-11-30')]));
    expect(await gap.ask('L-07')).toMatchObject({ status: 'belum_ada' });
  });

  it('L-09 cash flow per depot for the month, belum_ada if one cost term is unreadable', async () => {
    const { ask, sources } = build();
    expect((await ask('L-09')).value).toBe(1_000);
    expect(sources.cashFlow).toHaveBeenCalledWith(D1, '2026-11');
    sources.cashFlow.mockResolvedValueOnce({ netCashFlowIdr: null });
    expect(await ask('L-09')).toMatchObject({ status: 'belum_ada' });
    sources.cashFlow.mockResolvedValue(null);
    expect(await ask('L-09')).toMatchObject({ status: 'belum_ada' });
  });
});

describe('MoneyMetricsService: the catalogue', () => {
  it('answers every metric in the dictionary list with the unit it declares, and no personal data', async () => {
    const { ask } = build();
    for (const id of MONEY_METRIC_IDS) {
      const answer = await ask(id);
      expect(answer.metricId).toBe(id);
      expect(answer.unit).toBe(MONEY_METRICS[id].unit);
      expect(['ok', 'belum_ada', 'ditahan']).toContain(answer.status);
      if (answer.status !== 'ok') expect(answer.value).toBeNull();
    }
  });
});
