import { AdminConfigService } from '../../src/config/admin-config.service';
import { ReportDataset } from '../../src/domain/report-dataset';
import { ReportSourceHttpAdapter } from '../../src/infrastructure/http/report-source.http.adapter';

/*
 * Every branch here is a fail-CLOSED one, and that is the point. If this adapter answered
 * `[]` on an outage the sweep would write a perfectly valid, perfectly empty revenue
 * report — and an empty revenue report reads as a quiet month, not as a service being down.
 */

const FROM = new Date('2026-08-01T00:00:00.000Z');
const TO = new Date('2026-08-02T00:00:00.000Z');

const config = (over: Partial<Record<string, unknown>> = {}): AdminConfigService =>
  ({
    orderServiceUrl: 'http://order:3004',
    paymentServiceUrl: 'http://payment:3005',
    internalServiceKey: 'k',
    ...over,
  }) as unknown as AdminConfigService;

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('ReportSourceHttpAdapter', () => {
  it('reads the depot grouping from order-service under the internal key', async () => {
    const rows = [{ label: 'Depot A', orders: 2, revenue: 5000 }];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows }) });

    await expect(
      new ReportSourceHttpAdapter(config()).rowsFor(ReportDataset.REVENUE_BY_DEPOT, FROM, TO),
    ).resolves.toEqual(rows);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('http://order:3004/api/v1/reports/internal/export-rows');
    expect(url).toContain('dataset=REVENUE_BY_DEPOT');
    expect(url).toContain(`from=${FROM.toISOString()}`);
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe('k');
  });

  /*
   * E-4. The row source caps at 100. Finance opened a spreadsheet that simply stopped at
   * the 100th depot, with nothing in the file saying the rest existed — and a short month
   * and a cut-off month are indistinguishable once they are rows.
   */
  it('marks a truncated report in the file itself', async () => {
    const rows = [{ label: 'Depot A', orders: 2, revenue: 5000 }];
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rows, truncated: true }),
    });

    const out = await new ReportSourceHttpAdapter(config()).rowsFor(
      ReportDataset.REVENUE_BY_DEPOT,
      FROM,
      TO,
    );

    expect(out).toHaveLength(2);
    expect(out[1].label).toMatch(/TERPOTONG/);
    // Zeroed, so a SUM over the money column is not changed by the warning.
    expect(out[1]).toMatchObject({ orders: 0, revenue: 0 });
  });

  it('reads the product grouping from order-service too', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) });
    await new ReportSourceHttpAdapter(config()).rowsFor(ReportDataset.REVENUE_BY_PRODUCT, FROM, TO);
    expect(fetchMock.mock.calls[0][0]).toContain('dataset=REVENUE_BY_PRODUCT');
  });

  // Method lives in payment-service, and its path carries no dataset param — the URL
  // builder has to not staple an extra `&` onto a query string that has none yet.
  it('reads the method grouping from payment-service with a well-formed query', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) });
    await new ReportSourceHttpAdapter(config()).rowsFor(ReportDataset.REVENUE_BY_METHOD, FROM, TO);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      `http://payment:3005/api/v1/payments/internal/export-rows?from=${FROM.toISOString()}&to=${TO.toISOString()}`,
    );
  });

  it.each([
    ['order-service has no URL', { orderServiceUrl: '' }, ReportDataset.REVENUE_BY_DEPOT],
    ['payment-service has no URL', { paymentServiceUrl: '' }, ReportDataset.REVENUE_BY_METHOD],
    ['the internal key is unset', { internalServiceKey: '' }, ReportDataset.REVENUE_BY_DEPOT],
  ])('throws when %s', async (_case, over, dataset) => {
    await expect(
      new ReportSourceHttpAdapter(config(over)).rowsFor(dataset, FROM, TO),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx instead of reporting an empty month', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(
      new ReportSourceHttpAdapter(config()).rowsFor(ReportDataset.REVENUE_BY_DEPOT, FROM, TO),
    ).rejects.toThrow(/503/);
  });

  it('lets a network error propagate rather than swallowing it', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new ReportSourceHttpAdapter(config()).rowsFor(ReportDataset.REVENUE_BY_DEPOT, FROM, TO),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
