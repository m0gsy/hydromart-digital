import { HealthProbeHttpAdapter } from '../../src/infrastructure/http/health-probe.http.adapter';
import { FraudSignalsHttpAdapter } from '../../src/infrastructure/http/fraud-signals.http.adapter';
import { AdminConfigService } from '../../src/config/admin-config.service';

// Exercises the REAL HTTP adapter code (URL building, res.ok branch, catch → 'down')
// against a mocked global.fetch — the units the e2e's Fake* stand-ins never run. No
// network. The adapter takes a baseUrl directly (no config/internal key).

function res(init: { ok?: boolean; status?: number }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return { ok: init.ok ?? status < 400, status } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('HealthProbeHttpAdapter', () => {
  it("reports 'up' with httpStatus on a 2xx health response", async () => {
    fetchMock.mockResolvedValue(res({ ok: true, status: 200 }));
    const out = await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(out.status).toBe('up');
    expect(out.httpStatus).toBe(200);
    expect(typeof out.latencyMs).toBe('number');
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('hits GET /api/v1/health with an abort timeout signal', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3005/api/v1/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reports 'down' (never faked up) on a non-2xx response, keeping httpStatus", async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    const out = await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(out.status).toBe('down');
    expect(out.httpStatus).toBe(503);
  });

  it("reports 'down' with null httpStatus when the peer is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(out.status).toBe('down');
    expect(out.httpStatus).toBeNull();
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports 'down' with null httpStatus on a timeout abort", async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const out = await new HealthProbeHttpAdapter().probe('http://order:3005');
    expect(out.status).toBe('down');
    expect(out.httpStatus).toBeNull();
  });
});

/*
 * The fraud scan reads its one signal through here. Every branch is fail-CLOSED on purpose:
 * an empty flag queue is a real answer about a quiet week, so a service that could not be
 * reached must never be able to produce one — the reviewer would read "nothing suspicious".
 */
describe('FraudSignalsHttpAdapter', () => {
  const FROM = new Date('2026-07-17T00:00:00.000Z');
  const TO = new Date('2026-08-16T00:00:00.000Z');
  const cfg = (over: Record<string, unknown> = {}) =>
    ({
      paymentServiceUrl: 'http://payment:3005',
      internalServiceKey: 'k',
      ...over,
    }) as unknown as AdminConfigService;
  const call = (over: Record<string, unknown> = {}) =>
    new FraudSignalsHttpAdapter(cfg(over)).repeatedRefunds(FROM, TO, 3);

  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('asks payment-service for the window and threshold under the internal key', async () => {
    const customers = [{ customerId: 'cust-1', refunds: 4, amountIdr: 240_000 }];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ customers }) });

    await expect(call()).resolves.toEqual(customers);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/payments/internal/refund-counts');
    expect(String(url)).toContain('minRefunds=3');
    expect(String(url)).toContain(`from=${encodeURIComponent(FROM.toISOString())}`);
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe('k');
  });

  it.each([
    ['a non-2xx', () => fetchMock.mockResolvedValue({ ok: false, status: 503 })],
    ['an unreachable service', () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))],
    ['a 200 with no rows in it', () => fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })],
  ])('answers null on %s, never an empty queue', async (_label, arrange) => {
    arrange();
    await expect(call()).resolves.toBeNull();
  });

  it.each([
    ['no payment-service URL', { paymentServiceUrl: '' }],
    ['no internal key', { internalServiceKey: '' }],
  ])('answers null and makes no request with %s', async (_label, over) => {
    await expect(call(over)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
