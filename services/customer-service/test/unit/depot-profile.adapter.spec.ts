import { ChurnRiskHttpAdapter } from '../../src/infrastructure/http/churn-risk.http.adapter';
import { DepotProfileHttpAdapter } from '../../src/infrastructure/http/depot-profile.http.adapter';
import { buildTestConfig } from '../support/fakes';

/**
 * S2. Three fields the depot CRM card used to hardcode to null. Each has a "not known"
 * state that must not collapse into its false/zero: an unreachable service printing as
 * "not a subscriber", "low churn risk", or "0 km away" is worse than a dash, because all
 * three read as measurements somebody took.
 */
const DEPOT = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
});

const setFetch = (impl: unknown) => {
  (globalThis as { fetch: unknown }).fetch = impl;
};
const quiet = <T>(a: T): T => {
  jest
    .spyOn((a as unknown as { logger: { warn: () => void } }).logger, 'warn')
    .mockImplementation(() => undefined);
  return a;
};

describe('DepotProfileHttpAdapter', () => {
  const configured = buildTestConfig({
    DEPOT_SERVICE_URL: 'http://depot:3007',
    INTERNAL_SERVICE_KEY: 'k',
  });

  it('reads location from the PUBLIC depot projection, which already carries it', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ lat: -6.9, lng: 107.6, serviceRadiusKm: 5 }) });
    setFetch(fetchMock);

    await expect(new DepotProfileHttpAdapter(configured).geo(DEPOT)).resolves.toEqual({
      lat: -6.9,
      lng: 107.6,
      serviceRadiusKm: 5,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`http://depot:3007/api/v1/depots/${DEPOT}`);
  });

  // A depot with no coordinates cannot judge an address. "0 km away, in range" would put
  // every address inside every radius.
  it('returns null when the depot has no coordinates', async () => {
    setFetch(jest.fn().mockResolvedValue({ ok: true, json: async () => ({ serviceRadiusKm: 5 }) }));
    await expect(new DepotProfileHttpAdapter(configured).geo(DEPOT)).resolves.toBeNull();
  });

  it('defaults a missing radius to 0 rather than assuming a service area', async () => {
    setFetch(jest.fn().mockResolvedValue({ ok: true, json: async () => ({ lat: -6.9, lng: 107.6 }) }));
    await expect(new DepotProfileHttpAdapter(configured).geo(DEPOT)).resolves.toEqual({
      lat: -6.9,
      lng: 107.6,
      serviceRadiusKm: 0,
    });
  });

  it('returns null for geo without a round-trip when depot-service is unconfigured', async () => {
    const fetchMock = jest.fn();
    setFetch(fetchMock);
    await expect(
      new DepotProfileHttpAdapter(buildTestConfig({ INTERNAL_SERVICE_KEY: 'k' })).geo(DEPOT),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads subscriber ids over the internal key', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ customerIds: ['c1', 'c2'] }) });
    setFetch(fetchMock);

    await expect(new DepotProfileHttpAdapter(configured).subscriberIds(DEPOT)).resolves.toEqual([
      'c1',
      'c2',
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://depot:3007/api/v1/subscriptions/internal/customer-ids?depotId=${DEPOT}`);
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe('k');
  });

  // An answered request with no ids IS an empty set — that depot genuinely has no linked
  // subscribers. Only a failure is "not known".
  it('reads an answered body with no ids as an empty set, not as an outage', async () => {
    setFetch(jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(new DepotProfileHttpAdapter(configured).subscriberIds(DEPOT)).resolves.toEqual([]);
  });

  it.each([
    ['depot-service is unconfigured', { INTERNAL_SERVICE_KEY: 'k' }],
    ['there is no internal key', { DEPOT_SERVICE_URL: 'http://depot:3007' }],
  ])('returns null for subscribers without a round-trip when %s', async (_label, env) => {
    const fetchMock = jest.fn();
    setFetch(fetchMock);
    await expect(
      new DepotProfileHttpAdapter(buildTestConfig(env)).subscriberIds(DEPOT),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on a non-2xx and when depot-service is unreachable', async () => {
    setFetch(jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    await expect(quiet(new DepotProfileHttpAdapter(configured)).geo(DEPOT)).resolves.toBeNull();
    setFetch(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(
      quiet(new DepotProfileHttpAdapter(configured)).subscriberIds(DEPOT),
    ).resolves.toBeNull();
  });
});

describe('ChurnRiskHttpAdapter', () => {
  const configured = buildTestConfig({
    FORECAST_SERVICE_URL: 'http://forecast:3014',
    INTERNAL_SERVICE_KEY: 'k',
  });

  it('asks forecast-service for one customer with the internal key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ riskBand: 'HIGH' }) });
    setFetch(fetchMock);

    await expect(new ChurnRiskHttpAdapter(configured).bandFor(CUSTOMER)).resolves.toBe('HIGH');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://forecast:3014/api/v1/forecasts/internal/churn-band?customerId=${CUSTOMER}`,
    );
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe('k');
  });

  /*
   * Never 'LOW'. Low risk is the answer a manager acts on by doing NOTHING, so defaulting
   * to it on an outage would quietly retire the follow-up queue — the failure would look
   * like good news.
   */
  it.each([
    ['the customer has never ordered', { riskBand: null }],
    ['the band is not one we recognise', { riskBand: 'MAYBE' }],
    ['the body carries no band at all', {}],
  ])('returns null when %s', async (_label, body) => {
    setFetch(jest.fn().mockResolvedValue({ ok: true, json: async () => body }));
    await expect(new ChurnRiskHttpAdapter(configured).bandFor(CUSTOMER)).resolves.toBeNull();
  });

  it.each([
    ['forecast-service is unconfigured', { INTERNAL_SERVICE_KEY: 'k' }],
    ['there is no internal key', { FORECAST_SERVICE_URL: 'http://forecast:3014' }],
  ])('returns null without a round-trip when %s', async (_label, env) => {
    const fetchMock = jest.fn();
    setFetch(fetchMock);
    await expect(new ChurnRiskHttpAdapter(buildTestConfig(env)).bandFor(CUSTOMER)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on a non-2xx and when forecast-service is unreachable', async () => {
    setFetch(jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(quiet(new ChurnRiskHttpAdapter(configured)).bandFor(CUSTOMER)).resolves.toBeNull();
    setFetch(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(quiet(new ChurnRiskHttpAdapter(configured)).bandFor(CUSTOMER)).resolves.toBeNull();
  });
});
