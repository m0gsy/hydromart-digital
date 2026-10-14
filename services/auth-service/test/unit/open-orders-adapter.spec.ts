import { ServiceUnavailableException } from '@nestjs/common';

import { OpenOrdersHttpAdapter } from '../../src/infrastructure/http/open-orders.http.adapter';
import { AuthConfigService } from '../../src/config/auth-config.service';

// The guard before an irreversible erasure: every failure must RAISE. "Could not ask" is not
// "zero orders".
const config = (url = 'http://order:3004/', key = 'k'): AuthConfigService =>
  ({ serviceUrl: () => url.replace(/\/+$/, ''), internalServiceKey: key }) as never;

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
const reply = (init: { ok?: boolean; status?: number; body?: unknown; bad?: boolean }) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => {
    if (init.bad) throw new Error('not json');
    return init.body;
  },
});

describe('OpenOrdersHttpAdapter', () => {
  it('asks order-service with the internal key and returns the count', async () => {
    fetchMock.mockResolvedValue(reply({ body: { openCount: 4 } }));
    await expect(new OpenOrdersHttpAdapter(config()).countOpen('c 1')).resolves.toBe(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://order:3004/api/v1/orders/internal/customer-open-count?customerId=c%201');
    expect(init.headers['x-internal-key']).toBe('k');
  });

  it('raises when unconfigured, unreachable, refused, or answered with garbage', async () => {
    await expect(new OpenOrdersHttpAdapter(config('', 'k')).countOpen('c')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(new OpenOrdersHttpAdapter(config('http://o', '')).countOpen('c')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(new OpenOrdersHttpAdapter(config()).countOpen('c')).rejects.toThrow(/ECONNREFUSED/);

    fetchMock.mockResolvedValueOnce(reply({ ok: false, status: 500 }));
    await expect(new OpenOrdersHttpAdapter(config()).countOpen('c')).rejects.toThrow(/500/);

    for (const body of [{}, { openCount: -1 }, { openCount: 'x' }, null]) {
      fetchMock.mockResolvedValueOnce(reply({ body }));
      await expect(new OpenOrdersHttpAdapter(config()).countOpen('c')).rejects.toThrow(/tidak dikenali/);
    }
    fetchMock.mockResolvedValueOnce(reply({ bad: true }));
    await expect(new OpenOrdersHttpAdapter(config()).countOpen('c')).rejects.toThrow(/tidak dikenali/);
  });
});
