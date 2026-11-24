import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { LOYALTY_METRIC_IDS, LOYALTY_METRICS, LoyaltyMetricsService } from '../../src/application/ai-read/loyalty-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { STOCK_METRIC_IDS, STOCK_METRICS, StockMetricsService } from '../../src/application/ai-read/stock-metrics';
import { depotsOn, plusDays, stretchesOf } from '../../src/application/ai-read/stretches';
import { AiStockSourcesPort, MeterDayRow, StockLossRow } from '../../src/application/ports/ai-stock-sources.port';

/*
 * HD-6 H4: the stock group. The sources are stubbed; what is under test is what each metric does
 * with them: the formula, the stretch of days each depot may be read for, the WIB instants asked
 * for, and when it says belum_ada instead of a number.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-25T03:00:00.000Z'); // 10:00 WIB, 25 Nov
const NOVEMBER = { period: 'month', date: '2026-11-10' };

const user = { sub: 'u1', role: 'SUPER_ADMIN', depotId: null } as unknown as AuthenticatedUser;
const span = (depotId: string, from: string, to: string, legalEntityId: string | null = PT_A) => ({ depotId, legalEntityId, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: {
    depotIds: [...new Set(spans.map((s) => s.depotId))].sort(),
    legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
  },
});
const WHOLE = scopeOf([span(D1, '2026-11-01', '2026-11-30'), span(D2, '2026-11-01', '2026-11-30', PT_B)]);
// D1 changes legal entity on 16 Nov: PT_A first half, PT_B second half.
const SPLIT = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D1, '2026-11-16', '2026-11-30', PT_B), span(D2, '2026-11-01', '2026-11-30', PT_B)]);

const loss = (o: Partial<StockLossRow> = {}): StockLossRow => ({ depotId: D1, itemType: 'GALON', units: 0, valueIdr: 0, unpricedUnits: 0, ...o });
const day = (d: string, o: Partial<MeterDayRow> = {}): MeterDayRow => ({
  day: d,
  meterLiters: 2600,
  soldLiters: 2430,
  varianceLiters: 170,
  varianceGallons: 8.95,
  varianceIdr: 179_000,
  roYieldPct: null,
  ...o,
});

function build(scope: ReadScope = WHOLE, over: Partial<Record<keyof AiStockSourcesPort, jest.Mock>> = {}) {
  const sources = {
    position: jest.fn(async (ids: readonly string[]) =>
      ids.map((depotId) => ({
        depotId,
        lines: 4,
        lowLines: 1,
        outLines: 1,
        byType: [{ itemType: 'GALON', availableUnits: 40, lines: 2 }, { itemType: 'AIR', availableUnits: 500, lines: 2 }],
      })),
    ),
    wastage: jest.fn(async () => [loss({ units: 3, valueIdr: 60_000 })]),
    opname: jest.fn(async () => [loss({ units: -4, valueIdr: -80_000 })]),
    openPurchases: jest.fn(async (ids: readonly string[]) => ids.map((depotId) => ({ depotId, orders: 1, valueIdr: 20_500 }))),
    meterDays: jest.fn(async (_d: string, from: string): Promise<MeterDayRow[] | null> => [day(from)]),
    salesForecast: jest.fn(async () => ({ predictedDaily: [100_000, 110_000, 90_000, 100_000, 100_000, 120_000, 80_000], predictedTotal: 700_000 })),
    ...over,
  };
  const scopes = { resolve: jest.fn(async () => scope) } as unknown as ReadScopeService;
  return { sources, service: new StockMetricsService(scopes, sources as unknown as AiStockSourcesPort) };
}

describe('stretches', () => {
  it('groups depots that were readable over the same days, as WIB instants', () => {
    const out = stretchesOf(SPLIT, { timeZone: 'Asia/Jakarta' } as never);
    expect(out.map((s) => `${s.depotIds.join('+')}@${s.from}..${s.to}`).sort()).toEqual([
      `${D1}@2026-11-01..2026-11-15`,
      `${D1}@2026-11-16..2026-11-30`,
      `${D2}@2026-11-01..2026-11-30`,
    ]);
    const mid = out.find((s) => s.from === '2026-11-16')!;
    // 16 Nov 00:00 WIB is 15 Nov 17:00 UTC; the end is the exclusive start of 1 Dec WIB.
    expect(mid.range).toEqual({ from: '2026-11-15T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' });
  });

  it('lists the depots readable on one day, and counts calendar days', () => {
    expect(depotsOn(SPLIT, '2026-11-15')).toEqual([D1, D2]);
    expect(depotsOn(scopeOf([span(D1, '2026-11-01', '2026-11-20')]), '2026-11-25')).toEqual([]);
    expect(plusDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(plusDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('StockMetricsService, the door', () => {
  it('knows exactly the six stock metrics and 404s anything else', async () => {
    expect(STOCK_METRIC_IDS).toEqual(['S-01', 'S-02', 'S-03', 'S-04', 'S-05', 'S-06']);
    const { service } = build();
    await expect(service.answer('S-99', user, NOVEMBER, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.answer('toString', user, NOVEMBER, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.answer('S-02', user, { period: 'month', from: '2026-11-01', to: '2026-11-30' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('says belum_ada, not 0, when nothing is readable', async () => {
    const { service, sources } = build(scopeOf([]));
    const res = await service.answer('S-02', user, NOVEMBER, NOW);
    expect(res).toMatchObject({ status: 'belum_ada', value: null, scope: { depotIds: [] } });
    expect(sources.opname).not.toHaveBeenCalled();
  });

  it('echoes the metric, unit and period on every answer', async () => {
    const { service } = build();
    const res = await service.answer('S-05', user, NOVEMBER, NOW);
    expect(res).toMatchObject({ metricId: 'S-05', unit: STOCK_METRICS['S-05'].unit, asOf: NOW.toISOString() });
    // a metric about now is answered over today, not over the month that was sent
    expect(res.period).toMatchObject({ unit: 'day', from: '2026-11-25', to: '2026-11-25' });
    const month = await build().service.answer('S-02', user, NOVEMBER, NOW);
    expect(month.period).toMatchObject({ unit: 'month', from: '2026-11-01', to: '2026-11-30' });
    // ... and needs no period at all, while a nonsense one is still refused
    expect((await build().service.answer('S-01', user, {}, NOW)).status).toBe('ok');
    await expect(build().service.answer('S-01', user, { period: 'fortnight' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(build().service.answer('S-02', user, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('S-01 stock now', () => {
  it('adds up the depots readable today, available units by type', async () => {
    const { service, sources } = build();
    const res = await service.answer('S-01', user, NOVEMBER, NOW);
    expect(res.value).toEqual({ depots: 2, lines: 8, lowLines: 2, outLines: 2, availableByType: { GALON: 80, AIR: 1000 } });
    expect(sources.position).toHaveBeenCalledTimes(1);
    expect(sources.position).toHaveBeenCalledWith([D1, D2]);
    expect(res.label).toContain('baris tersembunyi tidak dihitung');
  });

  it('counts a depot only if it is readable TODAY, whatever period was asked', async () => {
    const { service, sources } = build(scopeOf([span(D1, '2026-11-01', '2026-11-20'), span(D2, '2026-11-01', '2026-11-30')]));
    await service.answer('S-01', user, NOVEMBER, NOW);
    expect(sources.position).toHaveBeenCalledWith([D2]);
    const none = await build(scopeOf([span(D1, '2026-11-01', '2026-11-20')])).service.answer('S-01', user, NOVEMBER, NOW);
    expect(none).toMatchObject({ status: 'belum_ada', value: null });
  });

  it('reads at most 100 depots per call and fails closed when any call fails', async () => {
    const many = scopeOf(Array.from({ length: 150 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-11-01', '2026-11-30')));
    const a = build(many);
    expect((await a.service.answer('S-01', user, NOVEMBER, NOW)).value).toMatchObject({ depots: 150, lines: 600 });
    expect(a.sources.position.mock.calls.map((c) => c[0].length)).toEqual([100, 50]);
    const b = build(many, { position: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(null) });
    expect(await b.service.answer('S-01', user, NOVEMBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
  });
});

describe('S-02 and S-03 losses', () => {
  it('asks each stretch of days in WIB instants, so a depot that changed entity is read only for its own days', async () => {
    const { service, sources } = build(SPLIT);
    await service.answer('S-03', user, NOVEMBER, NOW);
    const asked = sources.wastage.mock.calls.map((c) => `${c[0].join('+')}@${c[1].from}..${c[1].to}`).sort();
    expect(asked).toEqual(
      [
        `${D1}@2026-10-31T17:00:00.000Z..2026-11-15T17:00:00.000Z`,
        `${D1}@2026-11-15T17:00:00.000Z..2026-11-30T17:00:00.000Z`,
        `${D2}@2026-10-31T17:00:00.000Z..2026-11-30T17:00:00.000Z`,
      ].sort(),
    );
  });

  it('adds the units and the value per item type, and says what could not be priced', async () => {
    const { service } = build(WHOLE, {
      wastage: jest.fn(async () => [
        loss({ itemType: 'GALON', units: 3, valueIdr: 60_000 }),
        loss({ itemType: 'GALON', depotId: D2, units: 1, valueIdr: 20_000 }),
        loss({ itemType: 'TUTUP', units: 4, valueIdr: null, unpricedUnits: 4 }),
      ]),
    });
    const res = await service.answer('S-03', user, { period: 'month', date: '2026-11-10' }, NOW);
    expect(res.value).toEqual({
      byType: { GALON: { units: 4, valueIdr: 80_000, unpricedUnits: 0 }, TUTUP: { units: 4, valueIdr: null, unpricedUnits: 4 } },
      units: 8,
      valueIdr: 80_000,
      unpricedUnits: 4,
    });
    expect(res.label).toContain('tanpa galon yang dipinjamkan');
  });

  it('S-02 is signed (counted minus system) and keeps the opname label', async () => {
    const { service } = build(scopeOf([span(D1, '2026-11-01', '2026-11-30')]));
    const res = await service.answer('S-02', user, NOVEMBER, NOW);
    expect(res.value).toMatchObject({ units: -4, valueIdr: -80_000 });
    expect(res.label).toContain('ditolak HQ tidak dihitung');
  });

  it('is a real 0 when nothing happened, and null value only when units exist and none could be priced', async () => {
    const quiet = build(WHOLE, { wastage: jest.fn(async () => []) });
    expect((await quiet.service.answer('S-03', user, NOVEMBER, NOW)).value).toEqual({ byType: {}, units: 0, valueIdr: 0, unpricedUnits: 0 });
    const unpriced = build(WHOLE, { opname: jest.fn(async () => [loss({ units: -2, valueIdr: null, unpricedUnits: 2 })]) });
    expect((await unpriced.service.answer('S-02', user, NOVEMBER, NOW)).value).toMatchObject({ units: -2, valueIdr: null, unpricedUnits: 2 });
  });

  it('is belum_ada when one source read fails, never the sum of the others', async () => {
    const { service } = build(SPLIT, { wastage: jest.fn().mockResolvedValueOnce([loss({ units: 1 })]).mockResolvedValue(null) });
    expect(await service.answer('S-03', user, NOVEMBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
  });
});

describe('S-04 water meter', () => {
  it('asks the history of each depot for the days it was readable and adds the days with a closing reading', async () => {
    const { service, sources } = build(SPLIT, {
      meterDays: jest.fn(async (_d: string, from: string): Promise<MeterDayRow[] | null> => [
        day(from, { roYieldPct: 80 }),
        day(plusDays(from, 1), { roYieldPct: 90 }),
        day(plusDays(from, 2), { meterLiters: null, varianceLiters: null, varianceGallons: null, varianceIdr: null, soldLiters: 999 }), // not closed: left out
      ]),
    });
    const res = await service.answer('S-04', user, NOVEMBER, NOW);
    expect(sources.meterDays.mock.calls.map((c) => `${c[0]}@${c[1]}..${c[2]}`).sort()).toEqual(
      [`${D1}@2026-11-01..2026-11-15`, `${D1}@2026-11-16..2026-11-30`, `${D2}@2026-11-01..2026-11-30`].sort(),
    );
    // 3 history reads x 2 closed days
    expect(res.value).toEqual({
      daysWithReading: 6,
      meterLiters: 15_600,
      soldLiters: 14_580,
      varianceLiters: 1_020,
      varianceGallons: 53.7,
      varianceIdr: 1_074_000,
      daysWithoutPrice: 0,
      roYieldPct: 85,
    });
    expect(res.label).toContain('harga jual rata-rata per galon');
  });

  it('cuts a long period into reads of at most 92 days', async () => {
    const year = scopeOf([span(D1, '2026-01-01', '2026-12-31')]);
    const { service, sources } = build(year);
    await service.answer('S-04', user, { period: 'year', date: '2026-06-01' }, NOW);
    expect(sources.meterDays.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['2026-01-01', '2026-04-02'],
      ['2026-04-03', '2026-07-03'],
      ['2026-07-04', '2026-10-03'],
      ['2026-10-04', '2026-12-31'],
    ]);
  });

  it('holds the rupiah back when a day with a variance had no gallon sold (no price), never a silent undercount', async () => {
    const { service } = build(scopeOf([span(D1, '2026-11-01', '2026-11-30')]), {
      meterDays: jest.fn(async () => [day('2026-11-02'), day('2026-11-03', { varianceIdr: null }), day('2026-11-04', { varianceLiters: 0, varianceGallons: 0, varianceIdr: null })]),
    });
    expect((await service.answer('S-04', user, NOVEMBER, NOW)).value).toMatchObject({ daysWithReading: 3, varianceIdr: null, daysWithoutPrice: 1 });
  });

  it('is belum_ada with no closed day, with a failed read, and when it would need more than 300 reads', async () => {
    const open = build(WHOLE, { meterDays: jest.fn(async () => []) });
    expect(await open.service.answer('S-04', user, NOVEMBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
    const down = build(WHOLE, { meterDays: jest.fn(async () => null) });
    expect(await down.service.answer('S-04', user, NOVEMBER, NOW)).toMatchObject({ status: 'belum_ada' });
    const many = scopeOf(Array.from({ length: 301 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-11-01', '2026-11-30')));
    const huge = build(many);
    const res = await huge.service.answer('S-04', user, NOVEMBER, NOW);
    expect(res).toMatchObject({ status: 'belum_ada', value: null });
    expect(res.reason).toContain('persempit');
    expect(huge.sources.meterDays).not.toHaveBeenCalled();
  });

  it('a depot that is readable only the second half of the month is asked for those days only (WIB boundary 16 Nov)', async () => {
    const { service, sources } = build(scopeOf([span(D1, '2026-11-16', '2026-11-30', PT_B)]));
    await service.answer('S-04', user, NOVEMBER, NOW);
    expect(sources.meterDays).toHaveBeenCalledWith(D1, '2026-11-16', '2026-11-30');
  });
});

describe('S-05 purchasing now', () => {
  it('adds the open orders and the value still expected', async () => {
    const { service, sources } = build();
    expect((await service.answer('S-05', user, NOVEMBER, NOW)).value).toEqual({ orders: 2, valueIdr: 41_000 });
    expect(sources.openPurchases).toHaveBeenCalledWith([D1, D2]);
  });

  it('no open order is a real 0; a failed read or nobody readable today is belum_ada', async () => {
    expect((await build(WHOLE, { openPurchases: jest.fn(async () => []) }).service.answer('S-05', user, NOVEMBER, NOW)).value).toEqual({ orders: 0, valueIdr: 0 });
    expect(await build(WHOLE, { openPurchases: jest.fn(async () => null) }).service.answer('S-05', user, NOVEMBER, NOW)).toMatchObject({ status: 'belum_ada' });
    expect(await build(scopeOf([span(D1, '2026-11-01', '2026-11-10')])).service.answer('S-05', user, NOVEMBER, NOW)).toMatchObject({ status: 'belum_ada' });
  });
});

describe('S-06 forecast', () => {
  it('sums the depots day by day, and is called a forecast', async () => {
    const { service, sources } = build();
    const res = await service.answer('S-06', user, NOVEMBER, NOW);
    expect(res.value).toEqual({
      horizonDays: 7,
      historyDays: 30,
      predictedRevenueIdr: 1_400_000,
      predictedDaily: [200_000, 220_000, 180_000, 200_000, 200_000, 240_000, 160_000],
    });
    expect(res.label).toContain('PERKIRAAN');
    expect(sources.salesForecast.mock.calls.map((c) => c[0]).sort()).toEqual([D1, D2]);
  });

  it('is belum_ada when any depot cannot be forecast, or nobody is readable today', async () => {
    const down = build(WHOLE, { salesForecast: jest.fn().mockResolvedValueOnce({ predictedDaily: [1, 1, 1, 1, 1, 1, 1], predictedTotal: 7 }).mockResolvedValueOnce(null) });
    expect(await down.service.answer('S-06', user, NOVEMBER, NOW)).toMatchObject({ status: 'belum_ada', value: null });
    expect(await build(scopeOf([span(D1, '2026-11-01', '2026-11-10')])).service.answer('S-06', user, NOVEMBER, NOW)).toMatchObject({ status: 'belum_ada' });
  });
});

describe('LoyaltyMetricsService', () => {
  const svc = (scope: ReadScope = WHOLE) => new LoyaltyMetricsService({ resolve: jest.fn(async () => scope) } as unknown as ReadScopeService);

  it('knows O-01..O-09 and A-01, and every one answers belum_ada with its own reason and no number', async () => {
    expect(LOYALTY_METRIC_IDS).toEqual(['O-01', 'O-02', 'O-03', 'O-04', 'O-05', 'O-06', 'O-07', 'O-08', 'O-09', 'A-01']);
    for (const id of LOYALTY_METRIC_IDS) {
      const res = await svc().answer(id, user, NOVEMBER, NOW);
      expect(res).toMatchObject({ metricId: id, status: 'belum_ada', value: null, unit: LOYALTY_METRICS[id].unit, scope: { depotIds: [D1, D2] } });
      expect(res.reason).toBe(LOYALTY_METRICS[id].reason);
    }
  });

  it('404s an unknown id, and still refuses a bad period', async () => {
    await expect(svc().answer('O-99', user, NOVEMBER, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc().answer('O-04', user, {}, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});
