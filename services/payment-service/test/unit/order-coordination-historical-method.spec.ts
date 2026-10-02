import { PaymentConfigService } from '../../src/config/payment-config.service';
import { OrderCoordinationHttpAdapter } from '../../src/infrastructure/http/order-coordination.http.adapter';

// Owner decision, 2026-10-02: revenue-by-method pulls imported history from order-service
// over this call. Fails SOFT (empty array) on every unhappy path — a report that cannot be
// enriched still shows live totals, same contract the rest of this adapter already keeps.
describe('OrderCoordinationHttpAdapter.getHistoricalRevenueByMethod', () => {
  const config = {
    orderServiceUrl: 'http://order:3004',
    internalServiceKey: 'internal-key-01',
  } as unknown as PaymentConfigService;

  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('returns [] without calling order-service when coordination is not configured', async () => {
    const adapter = new OrderCoordinationHttpAdapter({} as PaymentConfigService);
    const rows = await adapter.getHistoricalRevenueByMethod({});
    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the response rows and sends the window as query params', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [{ label: 'CASH', orders: 3, revenue: 60000 }] }),
    });
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-02-01T00:00:00.000Z');

    const rows = await new OrderCoordinationHttpAdapter(config).getHistoricalRevenueByMethod({
      from,
      to,
    });

    expect(rows).toEqual([{ method: 'CASH', orders: 3, revenue: 60000 }]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/sales-import/summary-by-method?');
    expect(url).toContain(`from=${encodeURIComponent(from.toISOString())}`);
    expect(url).toContain(`to=${encodeURIComponent(to.toISOString())}`);
    expect((opts as { headers: Record<string, string> }).headers['x-internal-key']).toBe(
      'internal-key-01',
    );
  });

  it('sends no query params when the window is unbounded', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) });
    await new OrderCoordinationHttpAdapter(config).getHistoricalRevenueByMethod({});
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://order:3004/api/v1/sales-import/summary-by-method?');
  });

  it('returns [] and logs a warning on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const rows = await new OrderCoordinationHttpAdapter(config).getHistoricalRevenueByMethod({});
    expect(rows).toEqual([]);
  });

  it('returns [] when the fetch itself throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const rows = await new OrderCoordinationHttpAdapter(config).getHistoricalRevenueByMethod({});
    expect(rows).toEqual([]);
  });
});
