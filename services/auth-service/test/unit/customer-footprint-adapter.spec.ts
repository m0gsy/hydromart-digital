import { ServiceUnavailableException } from '@nestjs/common';

import { CustomerFootprintHttpAdapter } from '../../src/infrastructure/http/customer-footprint.http.adapter';
import { AuthConfigService } from '../../src/config/auth-config.service';

// The guard before closing a customer account: "could not ask" must never read as "unused".
const ORDER = 'http://order:3004';
const URLS: Record<string, string> = {
  ORDER_SERVICE_URL: ORDER,
  LOYALTY_SERVICE_URL: 'http://loyalty:3009',
};
const config = (urls = URLS, key = 'k'): AuthConfigService =>
  ({ serviceUrl: (env: string) => urls[env] ?? '', internalServiceKey: key }) as never;

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
/** Answer by URL, so the two parallel reads cannot swap bodies. */
const answer = (order: unknown, loyalty: unknown) =>
  fetchMock.mockImplementation(async (url: string) =>
    reply({ body: url.includes('/orders/') ? order : loyalty }),
  );

describe('CustomerFootprintHttpAdapter', () => {
  it('reads order and loyalty with the internal key; unused only when all three are zero', async () => {
    answer({ orders: 0, subscriptions: 0 }, { pointsBalance: 0 });
    await expect(new CustomerFootprintHttpAdapter(config()).isUnused('c 1')).resolves.toBe(true);
    const urls = fetchMock.mock.calls.map(([url]) => url).sort();
    expect(urls).toEqual([
      'http://loyalty:3009/api/v1/loyalty/accounts/c%201',
      'http://order:3004/api/v1/orders/internal/customer-activity?customerId=c%201',
    ]);
    for (const [, init] of fetchMock.mock.calls) expect(init.headers['x-internal-key']).toBe('k');

    for (const [order, loyalty] of [
      [{ orders: 1, subscriptions: 0 }, { pointsBalance: 0 }],
      [{ orders: 0, subscriptions: 2 }, { pointsBalance: 0 }],
      [{ orders: 0, subscriptions: 0 }, { pointsBalance: 15 }],
    ]) {
      answer(order, loyalty);
      await expect(new CustomerFootprintHttpAdapter(config()).isUnused('c')).resolves.toBe(false);
    }
  });

  it('raises when unconfigured, unreachable, refused, or answered with garbage', async () => {
    const noLoyalty = { ORDER_SERVICE_URL: ORDER };
    fetchMock.mockResolvedValue(reply({ body: { orders: 0, subscriptions: 0 } }));
    await expect(new CustomerFootprintHttpAdapter(config(noLoyalty)).isUnused('c')).rejects.toThrow(
      /LOYALTY_SERVICE_URL/,
    );
    await expect(new CustomerFootprintHttpAdapter(config(URLS, '')).isUnused('c')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new CustomerFootprintHttpAdapter(config()).isUnused('c')).rejects.toThrow(/ECONNREFUSED/);

    fetchMock.mockResolvedValue(reply({ ok: false, status: 500 }));
    await expect(new CustomerFootprintHttpAdapter(config()).isUnused('c')).rejects.toThrow(/500/);

    fetchMock.mockResolvedValue(reply({ bad: true }));
    await expect(new CustomerFootprintHttpAdapter(config()).isUnused('c')).rejects.toThrow(/tidak dikenali/);

    for (const order of [{}, { orders: -1, subscriptions: 0 }, { orders: 'x', subscriptions: 0 }]) {
      answer(order, { pointsBalance: 0 });
      await expect(new CustomerFootprintHttpAdapter(config()).isUnused('c')).rejects.toThrow(
        /angka yang tidak dikenali/,
      );
    }
  });
});
