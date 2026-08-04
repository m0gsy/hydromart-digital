import { DashboardSourcesHttpAdapter } from '../../src/infrastructure/http/dashboard-sources.http.adapter';
import { DashboardConfigService } from '../../src/config/dashboard-config.service';

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const errResponse = (status: number) => ({ ok: false, status, json: async () => ({}) });

type ConfigOverrides = Partial<{
  orderServiceUrl: string;
  deliveryServiceUrl: string;
  depotServiceUrl: string;
  adminServiceUrl: string | undefined;
  hrServiceUrl: string | undefined;
  customerServiceUrl: string | undefined;
  internalServiceKey: string;
}>;

function makeAdapter(overrides: ConfigOverrides = {}): DashboardSourcesHttpAdapter {
  const config = {
    orderServiceUrl: 'http://order',
    deliveryServiceUrl: 'http://delivery',
    depotServiceUrl: 'http://depot',
    adminServiceUrl: undefined,
    hrServiceUrl: undefined,
    customerServiceUrl: undefined,
    internalServiceKey: 'k-internal',
    ...overrides,
  } as unknown as DashboardConfigService;
  return new DashboardSourcesHttpAdapter(config);
}

describe('DashboardSourcesHttpAdapter', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('sales forwards range params and internal key, unwraps ok JSON', async () => {
    const body = { granularity: 'monthly', from: null, to: null, buckets: [] };
    fetchMock.mockResolvedValueOnce(okResponse(body));
    const adapter = makeAdapter();

    const result = await adapter.sales({ from: '2026-06-01', to: '2026-06-30' }, 'Bearer t');

    expect(result).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('http://order/api/v1/reports/sales?');
    expect(url).toContain('granularity=monthly');
    expect(url).toContain('from=2026-06-01');
    expect(url).toContain('to=2026-06-30');
    expect(init.headers['x-internal-key']).toBe('k-internal');
    expect(init.headers.accept).toBe('application/json');
  });

  it('returns null and warns when upstream responds non-ok', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(503));
    const adapter = makeAdapter();
    expect(await adapter.topCustomers({}, 10, 't')).toBeNull();
  });

  it('returns null when fetch throws (network error path)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const adapter = makeAdapter();
    expect(await adapter.topDepots({}, 10, 't')).toBeNull();
  });

  it('aborts the request when the timeout fires', async () => {
    jest.useFakeTimers();
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(
      () => new Promise((r) => { resolveFetch = r; }),
    );
    const adapter = makeAdapter();
    const promise = adapter.sales({}, 't');
    // Fire the 5s timeout callback → controller.abort().
    jest.advanceTimersByTime(5000);
    resolveFetch(okResponse({ buckets: [] }));
    await expect(promise).resolves.toEqual({ buckets: [] });
  });

  it('deliverySla applies depotIds + admin SLA threshold when admin-service is wired', async () => {
    // First fetch = sla-policy lookup, second = the sla report.
    fetchMock
      .mockResolvedValueOnce(okResponse({ onTimeThresholdMinutes: 90 }))
      .mockResolvedValueOnce(okResponse({ slaRate: 0.9 }));
    const adapter = makeAdapter({ adminServiceUrl: 'http://admin' });

    const result = await adapter.deliverySla({ from: '2026-06-01' }, 't', ['d1', 'd2']);

    expect(result).toEqual({ slaRate: 0.9 });
    expect(fetchMock.mock.calls[0][0]).toContain('http://admin/api/v1/sla-policy');
    const slaUrl = fetchMock.mock.calls[1][0];
    expect(slaUrl).toContain('http://delivery/api/v1/reports/sla?');
    expect(slaUrl).toContain('depotIds=d1%2Cd2');
    expect(slaUrl).toContain('thresholdMinutes=90');
  });

  it('deliverySla omits threshold + query string when admin unset and range empty', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ slaRate: 1 }));
    const adapter = makeAdapter(); // no adminServiceUrl → slaThresholdMinutes returns null

    const result = await adapter.deliverySla({}, 't');

    expect(result).toEqual({ slaRate: 1 });
    // Only one fetch (no sla-policy lookup) and no trailing query string.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://delivery/api/v1/reports/sla');
  });

  it('slaThresholdMinutes returns null when admin policy lookup fails', async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(500)) // policy lookup null
      .mockResolvedValueOnce(okResponse({ slaRate: 0.5 }));
    const adapter = makeAdapter({ adminServiceUrl: 'http://admin' });

    await adapter.deliverySla({}, 't');
    // Threshold null → sla url carries no thresholdMinutes.
    expect(fetchMock.mock.calls[1][0]).not.toContain('thresholdMinutes');
  });

  it('myDepots forwards the caller JWT as authorization header', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ id: 'd1' }]));
    const adapter = makeAdapter();

    const result = await adapter.myDepots('Bearer user-jwt');

    expect(result).toEqual([{ id: 'd1' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://depot/api/v1/depots/mine');
    expect(init.headers.authorization).toBe('Bearer user-jwt');
    expect(init.headers['x-internal-key']).toBeUndefined();
  });

  it('lowStock builds a depotId-scoped internal request', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ itemId: 'i1', depotId: 'd1' }]));
    const adapter = makeAdapter();

    await adapter.lowStock('d1', 't');
    expect(fetchMock.mock.calls[0][0]).toBe('http://depot/api/v1/inventory/low-stock?depotId=d1');
  });

  it('allDepots unwraps the page items, and maps a failed page to null', async () => {
    const adapter = makeAdapter();
    fetchMock.mockResolvedValueOnce(okResponse({ items: [{ id: 'd1' }] }));
    expect(await adapter.allDepots('t')).toEqual([{ id: 'd1' }]);

    fetchMock.mockResolvedValueOnce(errResponse(502));
    expect(await adapter.allDepots('t')).toBeNull();
  });

  it('slaByDepot adds thresholdMinutes when admin wired, and no query when not', async () => {
    const withAdmin = makeAdapter({ adminServiceUrl: 'http://admin' });
    fetchMock
      .mockResolvedValueOnce(okResponse({ onTimeThresholdMinutes: 45 }))
      .mockResolvedValueOnce(okResponse({ depots: [] }));
    await withAdmin.slaByDepot({ to: '2026-06-30' }, 't');
    expect(fetchMock.mock.calls[1][0]).toContain('thresholdMinutes=45');

    fetchMock.mockReset();
    const noAdmin = makeAdapter();
    fetchMock.mockResolvedValueOnce(okResponse({ depots: [] }));
    await noAdmin.slaByDepot({}, 't');
    expect(fetchMock.mock.calls[0][0]).toBe('http://delivery/api/v1/reports/sla-by-depot');
  });

  it('ratingByDepot appends a query only when a range is present', async () => {
    const adapter = makeAdapter();
    fetchMock.mockResolvedValueOnce(okResponse({ items: [] }));
    await adapter.ratingByDepot({ from: '2026-06-01' }, 't');
    expect(fetchMock.mock.calls[0][0]).toContain('rating-by-depot?from=2026-06-01');

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okResponse({ items: [] }));
    await adapter.ratingByDepot({}, 't');
    expect(fetchMock.mock.calls[0][0]).toBe('http://order/api/v1/reports/rating-by-depot');
  });

  it('depotMonthly and operationalCosts build their internal report URLs', async () => {
    const adapter = makeAdapter();
    fetchMock.mockResolvedValueOnce(okResponse({ revenueIdr: 1 }));
    await adapter.depotMonthly('d1', '2026-07', 't');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://order/api/v1/reports/depot-monthly?depotId=d1&month=2026-07',
    );

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okResponse({ cogs: {} }));
    await adapter.operationalCosts('d1', { from: 'a', to: 'b' }, 't');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://depot/api/v1/reports/operational-costs?depotId=d1&from=a&to=b',
    );
  });

  it('hrSummary returns null without a call when hr-service is unwired', async () => {
    const adapter = makeAdapter();
    expect(await adapter.hrSummary('d1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hrSummary fetches the internal depot-summary when hr-service is wired', async () => {
    const adapter = makeAdapter({ hrServiceUrl: 'http://hr' });
    fetchMock.mockResolvedValueOnce(okResponse({ depotId: 'd1', lateToday: 0 }));
    await adapter.hrSummary('d1');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://hr/api/v1/hr-reports/internal/depot-summary?depotId=d1',
    );
  });

  it('crmSummary returns null without a call when customer-service is unwired', async () => {
    const adapter = makeAdapter();
    expect(await adapter.crmSummary('d1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('crmSummary fetches the internal crm-summary when customer-service is wired', async () => {
    const adapter = makeAdapter({ customerServiceUrl: 'http://customer' });
    fetchMock.mockResolvedValueOnce(okResponse({ counts: {} }));
    await adapter.crmSummary('d1');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://customer/api/v1/customers/internal/crm-summary?depotId=d1',
    );
  });
  it('lowStockMany asks depot-service once for the whole set and groups by depot', async () => {
    const adapter = makeAdapter();
    fetchMock.mockResolvedValueOnce(
      okResponse([
        { itemId: 'i1', depotId: 'd1' },
        { itemId: 'i2', depotId: 'd2' },
        { itemId: 'i3', depotId: 'd1' },
      ]),
    );
    const out = await adapter.lowStockMany(['d1', 'd2', 'd3'], 'Bearer t');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://depot/api/v1/inventory/low-stock?depotIds=d1%2Cd2%2Cd3',
    );
    expect(out?.get('d1')).toHaveLength(2);
    // A depot with nothing low is an empty list, not a missing key.
    expect(out?.get('d3')).toEqual([]);
  });

  it('lowStockMany short-circuits an empty set and propagates a dead source as null', async () => {
    const adapter = makeAdapter();
    expect((await adapter.lowStockMany([], 'Bearer t'))?.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(errResponse(503));
    expect(await adapter.lowStockMany(['d1'], 'Bearer t')).toBeNull();
  });

  it('hrSummaryMany asks once and answers in the order requested', async () => {
    const adapter = makeAdapter({ hrServiceUrl: 'http://hr' });
    fetchMock.mockResolvedValueOnce(okResponse([{ depotId: 'd2', lateToday: 3 }]));
    const out = await adapter.hrSummaryMany(['d1', 'd2']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://hr/api/v1/hr-reports/internal/depot-summaries?depotIds=d1%2Cd2',
    );
    expect(out[0]).toBeNull();
    expect(out[1]).toMatchObject({ depotId: 'd2' });
  });

  it('hrSummaryMany yields one null per depot when hr-service is unwired or down', async () => {
    expect(await makeAdapter().hrSummaryMany(['d1', 'd2'])).toEqual([null, null]);
    expect(fetchMock).not.toHaveBeenCalled();
    const wired = makeAdapter({ hrServiceUrl: 'http://hr' });
    expect(await wired.hrSummaryMany([])).toEqual([]);
    fetchMock.mockResolvedValueOnce(errResponse(500));
    expect(await wired.hrSummaryMany(['d1'])).toEqual([null]);
  });

  it('crmSummaryMany asks once and answers in the order requested', async () => {
    const adapter = makeAdapter({ customerServiceUrl: 'http://customer' });
    fetchMock.mockResolvedValueOnce(okResponse([{ depotId: 'd1', counts: {} }]));
    const out = await adapter.crmSummaryMany(['d1', 'd2']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://customer/api/v1/customers/internal/crm-summaries?depotIds=d1%2Cd2',
    );
    expect(out[1]).toBeNull();
  });

  it('crmSummaryMany yields one null per depot when customer-service is unwired or down', async () => {
    expect(await makeAdapter().crmSummaryMany(['d1'])).toEqual([null]);
    expect(fetchMock).not.toHaveBeenCalled();
    const wired = makeAdapter({ customerServiceUrl: 'http://customer' });
    expect(await wired.crmSummaryMany([])).toEqual([]);
    fetchMock.mockResolvedValueOnce(errResponse(500));
    expect(await wired.crmSummaryMany(['d1'])).toEqual([null]);
  });
});
