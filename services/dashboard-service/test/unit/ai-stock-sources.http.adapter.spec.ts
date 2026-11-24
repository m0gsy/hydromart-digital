import { DashboardConfigService } from '../../src/config/dashboard-config.service';
import { AiStockSourcesHttpAdapter } from '../../src/infrastructure/http/ai-stock-sources.http.adapter';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const RANGE = { from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' };

function adapter(forecast: string | null = 'http://forecast.test') {
  const config = {
    orderServiceUrl: 'http://order.test',
    depotServiceUrl: 'http://depot.test',
    forecastServiceUrl: forecast ?? undefined,
    internalServiceKey: 'k',
  } as unknown as DashboardConfigService;
  return new AiStockSourcesHttpAdapter(config);
}

/** Answers every call with `body` (or a failure), and records the calls. */
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

const position = { depotId: D1, lines: 4, lowLines: 1, outLines: 0, byType: [{ itemType: 'GALON', availableUnits: 9, lines: 2 }] };
const lossRow = { depotId: D1, itemType: 'GALON', units: 3, valueIdr: null, unpricedUnits: 3 };
const meterRow = { day: '2026-11-02', meterLiters: 2600, soldLiters: 2430, varianceLiters: 170, varianceGallons: 8.95, varianceIdr: null, roYieldPct: null };

describe('AiStockSourcesHttpAdapter (HD-6 H4), depot-service', () => {
  it('asks for the depots (and the instants) with the internal key', async () => {
    const calls = answer({ items: [position] });
    await expect(adapter().position([D1, D2])).resolves.toEqual([position]);
    expect(calls[0].url.pathname).toBe('/api/v1/internal/ai-stock/position');
    expect(calls[0].url.searchParams.get('depotIds')).toBe(`${D1},${D2}`);
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-key']).toBe('k');

    const w = answer({ items: [lossRow] });
    await expect(adapter().wastage([D1], RANGE)).resolves.toEqual([lossRow]);
    expect(w[0].url.pathname).toBe('/api/v1/internal/ai-stock/wastage');
    expect(w[0].url.searchParams.get('from')).toBe(RANGE.from);
    expect(w[0].url.searchParams.get('to')).toBe(RANGE.to);
    const o = answer({ items: [lossRow] });
    await adapter().opname([D1], RANGE);
    expect(o[0].url.pathname).toBe('/api/v1/internal/ai-stock/opname');
    const p = answer({ items: [{ depotId: D1, orders: 2, valueIdr: 5 }] });
    await expect(adapter().openPurchases([D1])).resolves.toEqual([{ depotId: D1, orders: 2, valueIdr: 5 }]);
    expect(p[0].url.pathname).toBe('/api/v1/internal/ai-stock/open-purchases');
  });

  it.each([
    ['a failed call', { items: [] }, false],
    ['an unreachable service', 'throw', true],
    ['an answer without the list', {}, true],
    ['a row for a depot nobody asked about', { items: [{ ...position, depotId: D2 }] }, true],
    ['a row with a string for a number', { items: [{ ...position, lines: '4' }] }, true],
    ['a row with a broken breakdown', { items: [{ ...position, byType: [{ itemType: 'GALON' }] }] }, true],
  ])('position is null for %s', async (_name, body, ok) => {
    answer(body, ok as boolean);
    await expect(adapter().position([D1])).resolves.toBeNull();
  });

  it.each([
    ['a loss row without its type', { items: [{ ...lossRow, itemType: 3 }] }],
    ['a loss row with a string value', { items: [{ ...lossRow, valueIdr: 'x' }] }],
    ['a loss row for another depot', { items: [{ ...lossRow, depotId: D2 }] }],
  ])('wastage and opname are null for %s', async (_name, body) => {
    answer(body);
    await expect(adapter().wastage([D1], RANGE)).resolves.toBeNull();
    await expect(adapter().opname([D1], RANGE)).resolves.toBeNull();
  });

  it('open purchases are null for a row that is not numbers', async () => {
    answer({ items: [{ depotId: D1, orders: 'a', valueIdr: 1 }] });
    await expect(adapter().openPurchases([D1])).resolves.toBeNull();
  });
});

describe('AiStockSourcesHttpAdapter (HD-6 H4), order-service meter', () => {
  it('asks the history of one depot for the days', async () => {
    const calls = answer([meterRow]);
    await expect(adapter().meterDays(D1, '2026-11-01', '2026-11-30')).resolves.toEqual([meterRow]);
    expect(calls[0].url.pathname).toBe(`/api/v1/reports/meter/${D1}`);
    expect(calls[0].url.searchParams.get('from')).toBe('2026-11-01');
    expect(calls[0].url.searchParams.get('to')).toBe('2026-11-30');
  });

  it.each([
    ['a failed call', [meterRow], false],
    ['an answer that is not a list', { rows: [] }, true],
    ['a day outside the days asked', [{ ...meterRow, day: '2026-12-01' }], true],
    ['a day before the days asked', [{ ...meterRow, day: '2026-10-31' }], true],
    ['a row with a string for a number', [{ ...meterRow, soldLiters: '1' }], true],
    ['a row without the rupiah column (an order-service from before 27-A)', [{ ...meterRow, varianceIdr: undefined }], true],
  ])('is null for %s', async (_name, body, ok) => {
    answer(body, ok as boolean);
    await expect(adapter().meterDays(D1, '2026-11-01', '2026-11-30')).resolves.toBeNull();
  });
});

describe('AiStockSourcesHttpAdapter (HD-6 H4), forecast-service', () => {
  const forecast = { depotId: D1, avgDaily: 1, trendSlope: 0, predictedDaily: [1, 2, 3, 4, 5, 6, 7], predictedTotal: 28, history: [] };

  it('asks 7 days ahead from 30 days of history for one depot', async () => {
    const calls = answer(forecast);
    await expect(adapter().salesForecast(D1)).resolves.toEqual({ predictedDaily: [1, 2, 3, 4, 5, 6, 7], predictedTotal: 28 });
    expect(calls[0].url.pathname).toBe('/api/v1/forecast/sales');
    expect(calls[0].url.searchParams.get('depotId')).toBe(D1);
    expect(calls[0].url.searchParams.get('historyDays')).toBe('30');
    expect(calls[0].url.searchParams.get('horizonDays')).toBe('7');
  });

  it('is null without a forecast service, and for any answer that is not whole', async () => {
    answer(forecast);
    await expect(adapter('').salesForecast(D1)).resolves.toBeNull();
    await expect(adapter(null).salesForecast(D1)).resolves.toBeNull();
    for (const body of [
      { ...forecast, depotId: D2 },
      { ...forecast, depotId: null },
      { ...forecast, predictedTotal: '28' },
      { ...forecast, predictedDaily: [1, 2, 3] },
      { ...forecast, predictedDaily: [1, 2, 3, 4, 5, 6, 'x'] },
      { ...forecast, predictedDaily: 'no' },
    ]) {
      jest.restoreAllMocks();
      answer(body);
      await expect(adapter().salesForecast(D1)).resolves.toBeNull();
    }
    jest.restoreAllMocks();
    answer({}, false);
    await expect(adapter().salesForecast(D1)).resolves.toBeNull();
  });
});
