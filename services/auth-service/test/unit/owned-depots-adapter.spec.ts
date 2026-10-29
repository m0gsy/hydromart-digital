import { ServiceUnavailableException } from '@nestjs/common';

import { OwnedDepotsHttpAdapter } from '../../src/infrastructure/http/owned-depots.http.adapter';
import { AuthConfigService } from '../../src/config/auth-config.service';

// The guard before switching a franchise owner off: every failure must RAISE. "Could not ask"
// is not "owns nothing".
const config = (url = 'http://depot:3003/', key = 'k'): AuthConfigService =>
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

describe('OwnedDepotsHttpAdapter', () => {
  it('asks depot-service with the internal key and counts the depots', async () => {
    fetchMock.mockResolvedValue(reply({ body: { depotIds: ['a', 'b'] } }));
    await expect(new OwnedDepotsHttpAdapter(config()).countOwned('o 1')).resolves.toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://depot:3003/api/v1/depots/internal/owned/o%201');
    expect(init.headers['x-internal-key']).toBe('k');
  });

  it('answers 0 for an owner with no depots', async () => {
    fetchMock.mockResolvedValue(reply({ body: { depotIds: [] } }));
    await expect(new OwnedDepotsHttpAdapter(config()).countOwned('o')).resolves.toBe(0);
  });

  // A depot-service that accepts the connection and never answers must not hang the console.
  it('gives up on a depot-service that never answers', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const pending = expect(new OwnedDepotsHttpAdapter(config()).countOwned('o')).rejects.toThrow(
        /tidak terjangkau: aborted/,
      );
      await jest.advanceTimersByTimeAsync(10_000);
      await pending;
    } finally {
      jest.useRealTimers();
    }
  });

  it('raises when unconfigured, unreachable, refused, or answered with garbage', async () => {
    await expect(
      new OwnedDepotsHttpAdapter(config('', 'k')).countOwned('o'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      new OwnedDepotsHttpAdapter(config('http://d', '')).countOwned('o'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(new OwnedDepotsHttpAdapter(config()).countOwned('o')).rejects.toThrow(
      /ECONNREFUSED/,
    );

    fetchMock.mockResolvedValueOnce(reply({ ok: false, status: 500 }));
    await expect(new OwnedDepotsHttpAdapter(config()).countOwned('o')).rejects.toThrow(/500/);

    for (const body of [{}, { depotIds: 'x' }, null]) {
      fetchMock.mockResolvedValueOnce(reply({ body }));
      await expect(new OwnedDepotsHttpAdapter(config()).countOwned('o')).rejects.toThrow(
        /tidak dikenali/,
      );
    }
    fetchMock.mockResolvedValueOnce(reply({ bad: true }));
    await expect(new OwnedDepotsHttpAdapter(config()).countOwned('o')).rejects.toThrow(
      /tidak dikenali/,
    );
  });
});
