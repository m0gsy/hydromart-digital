import { HrConfigService } from '../../src/config/hr-config.service';
import { OrderSalesHttpAdapter } from '../../src/infrastructure/http/order-sales.http.adapter';

// Exercises the REAL adapter (URL/query build, x-internal-key header, res.ok branch, fail-SOFT
// catch + non-number guard) against a mocked global.fetch. Fail-soft = any problem returns null.

function makeConfig(url = 'http://order:3010/', internalKey = 'k-secret'): HrConfigService {
  return { orderService: { url, internalKey } } as unknown as HrConfigService;
}

function res(init: { ok?: boolean; status?: number; body?: unknown }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => init.body ?? {},
  } as unknown as Response;
}

const fetchMock = jest.fn();
const FROM = new Date('2026-07-01T00:00:00.000Z');
const TO = new Date('2026-07-31T23:59:59.000Z');

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('OrderSalesHttpAdapter.depotSales', () => {
  it('returns null without calling fetch when order-service url is missing', async () => {
    const out = await new OrderSalesHttpAdapter(makeConfig('', 'k')).depotSales('d1', FROM, TO);
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without calling fetch when the internal key is missing', async () => {
    const out = await new OrderSalesHttpAdapter(makeConfig('http://order:3010', '')).depotSales(
      'd1',
      FROM,
      TO,
    );
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the internal depot-sales endpoint (trailing slash stripped, key header sent) and returns totalIdr', async () => {
    fetchMock.mockResolvedValue(res({ body: { totalIdr: 12_500_000 } }));
    const out = await new OrderSalesHttpAdapter(makeConfig()).depotSales('depot-1', FROM, TO);
    expect(out).toBe(12_500_000);
    const [calledUrl, opts] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain('http://order:3010/api/v1/orders/internal/depot-sales?');
    expect(calledUrl).toContain('depotId=depot-1');
    expect(calledUrl).toContain(`from=${encodeURIComponent(FROM.toISOString())}`);
    expect(opts.headers).toEqual({ 'x-internal-key': 'k-secret' });
  });

  it('returns null when the response body has no numeric totalIdr', async () => {
    fetchMock.mockResolvedValue(res({ body: { totalIdr: 'nope' } }));
    expect(await new OrderSalesHttpAdapter(makeConfig()).depotSales('d1', FROM, TO)).toBeNull();
  });

  it('returns null on a non-2xx response (fail soft, never fabricate 0)', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    expect(await new OrderSalesHttpAdapter(makeConfig()).depotSales('d1', FROM, TO)).toBeNull();
  });

  it('returns null when order-service is unreachable (network error caught)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await new OrderSalesHttpAdapter(makeConfig()).depotSales('d1', FROM, TO)).toBeNull();
  });

  it('handles a non-Error throw in the catch branch', async () => {
    fetchMock.mockRejectedValue('boom-string');
    expect(await new OrderSalesHttpAdapter(makeConfig()).depotSales('d1', FROM, TO)).toBeNull();
  });
});
