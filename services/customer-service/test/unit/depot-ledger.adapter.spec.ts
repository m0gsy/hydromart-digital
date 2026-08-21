import { DepotLedgerHttpAdapter } from '../../src/infrastructure/http/depot-ledger.http.adapter';
import { buildTestConfig } from '../support/fakes';

/**
 * J-2. The whole point of this adapter is the difference between `[]` and `null`.
 *
 * `[]` means "no customer owes this depot anything" and the directory prints zeroes; `null`
 * means "not known" and the directory says "belum tersambung". A blank cell reading as zero
 * gallons on loan is a deposit quietly disappearing, so every failure path here is asserted
 * to produce `null` — never an empty array.
 */
describe('DepotLedgerHttpAdapter', () => {
  const DEPOT = '11111111-1111-4111-8111-111111111111';
  const configured = buildTestConfig({
    DEPOT_SERVICE_URL: 'http://depot:3007',
    INTERNAL_SERVICE_KEY: 'k',
  });
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    (globalThis as { fetch: unknown }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function quiet(adapter: DepotLedgerHttpAdapter) {
    jest
      .spyOn(adapter['logger'], 'warn')
      .mockImplementation(() => undefined);
    return adapter;
  }

  it('asks depot-service for one depot, with the internal key', async () => {
    const rows = [{ customerId: 'c1', gallonsOnLoan: 2, depositHeldIdr: 40_000 }];
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => rows });
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    await expect(
      new DepotLedgerHttpAdapter(configured).gallonsByCustomer(DEPOT),
    ).resolves.toEqual(rows);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://depot:3007/api/v1/gallon-outstanding/internal/by-customer?depotId=${DEPOT}`,
    );
    expect(init.headers['x-internal-key']).toBe('k');
  });

  // I5: the mirror read, for the customer's own screen rather than the depot's directory.
  it('asks depot-service for one customer, across every depot they have used', async () => {
    const rows = [
      { depotId: 'd1', depotName: 'Depot Cikini', gallonsOnLoan: 2, depositHeldIdr: 40_000 },
    ];
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => rows });
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    await expect(
      new DepotLedgerHttpAdapter(configured).depositsForCustomer('c1'),
    ).resolves.toEqual(rows);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://depot:3007/api/v1/gallon-outstanding/internal/for-customer?customerId=c1',
    );
    expect(init.headers['x-internal-key']).toBe('k');
  });

  // `null`, not `[]`, for the same reason as its sibling: `[]` would tell the customer they
  // are holding nothing and owed nothing, and that is somebody's money.
  it('is null when the deposit read fails, never an empty list', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(
      quiet(new DepotLedgerHttpAdapter(configured)).depositsForCustomer('c1'),
    ).resolves.toBeNull();
  });

  it('is null, not [], when depot-service is unconfigured — and calls nothing', async () => {
    const fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    const blank = buildTestConfig({ DEPOT_SERVICE_URL: '', INTERNAL_SERVICE_KEY: 'k' });
    const noKey = buildTestConfig({ DEPOT_SERVICE_URL: 'http://depot:3007', INTERNAL_SERVICE_KEY: '' });

    await expect(new DepotLedgerHttpAdapter(blank).gallonsByCustomer(DEPOT)).resolves.toBeNull();
    await expect(new DepotLedgerHttpAdapter(noKey).gallonsByCustomer(DEPOT)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is null on a refusal, and warns', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const adapter = quiet(new DepotLedgerHttpAdapter(configured));
    const warn = jest.spyOn(adapter['logger'], 'warn');

    await expect(adapter.gallonsByCustomer(DEPOT)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('503'));
  });

  it('is null when depot-service is unreachable', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const adapter = quiet(new DepotLedgerHttpAdapter(configured));

    await expect(adapter.gallonsByCustomer(DEPOT)).resolves.toBeNull();
  });

  // A 200 carrying something else is not "nobody owes anything".
  it('is null when the body is not an array', async () => {
    (globalThis as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) });
    const adapter = quiet(new DepotLedgerHttpAdapter(configured));

    await expect(adapter.gallonsByCustomer(DEPOT)).resolves.toBeNull();
  });

  it('passes an empty ledger through as an empty ledger', async () => {
    (globalThis as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });

    await expect(new DepotLedgerHttpAdapter(configured).gallonsByCustomer(DEPOT)).resolves.toEqual(
      [],
    );
  });

  /**
   * The movement history is the one read that falls back to `[]` rather than `null`, and it
   * is deliberate: the two stat cards above it already say "belum tersambung" when the
   * service is down, so an empty history there cannot be mistaken for a confirmed zero.
   */
  describe('customerLedger', () => {
    const CUSTOMER = '22222222-2222-4222-8222-222222222222';

    it('asks for the one customer, with the internal key', async () => {
      const rows = [{ id: 'l1', type: 'ISSUE', quantity: 2, amountIdr: 40_000, at: '2026-08-01T00:00:00.000Z' }];
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => rows });
      (globalThis as { fetch: unknown }).fetch = fetchMock;

      await expect(
        new DepotLedgerHttpAdapter(configured).customerLedger(DEPOT, CUSTOMER),
      ).resolves.toEqual(rows);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        `http://depot:3007/api/v1/gallon-outstanding/internal/customer-ledger?depotId=${DEPOT}&customerId=${CUSTOMER}`,
      );
      expect(init.headers['x-internal-key']).toBe('k');
    });

    it('is [] — not null — on every failure path', async () => {
      const blank = buildTestConfig({ DEPOT_SERVICE_URL: '', INTERNAL_SERVICE_KEY: 'k' });
      await expect(new DepotLedgerHttpAdapter(blank).customerLedger(DEPOT, CUSTOMER)).resolves.toEqual([]);

      (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
      await expect(quiet(new DepotLedgerHttpAdapter(configured)).customerLedger(DEPOT, CUSTOMER)).resolves.toEqual([]);

      (globalThis as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(quiet(new DepotLedgerHttpAdapter(configured)).customerLedger(DEPOT, CUSTOMER)).resolves.toEqual([]);

      (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      await expect(quiet(new DepotLedgerHttpAdapter(configured)).customerLedger(DEPOT, CUSTOMER)).resolves.toEqual([]);
    });
  });
});
