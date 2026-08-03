import { ProductConfigService } from '../../src/config/product-config.service';
import { StockNotifierHttpAdapter } from '../../src/infrastructure/http/stock-notifier.http.adapter';

// Exercises the real adapter against a mocked global.fetch: URL/header/body building and
// every fail-open branch. No network.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): ProductConfigService {
  return {
    depotServiceUrl: 'http://depots:3007',
    internalServiceKey: KEY,
    ...over,
  } as unknown as ProductConfigService;
}

const change = () => ({ productId: 'p1', name: 'Air Galon 19L', unit: 'Galon', active: true });

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('StockNotifierHttpAdapter', () => {
  it.each([['depotServiceUrl'], ['internalServiceKey']])(
    'skips (fail open) when %s is blank',
    async (key) => {
      await new StockNotifierHttpAdapter(makeConfig({ [key]: '' })).productChanged(change());
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('posts the change to the depot internal endpoint with x-internal-key', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response);
    await new StockNotifierHttpAdapter(makeConfig()).productChanged(change());
    expect(fetchMock).toHaveBeenCalledWith(
      'http://depots:3007/api/v1/inventory/internal/product-changed',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': KEY }),
      }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual(change());
  });

  // The adapter arms a timer that aborts its own request. Without letting it fire, a
  // depot-service that accepts the connection and then hangs would keep a catalog save
  // waiting forever — the abort is what turns that into a logged miss.
  it('aborts and settles when depot-service hangs', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const aborted = new Error('The operation was aborted');
            aborted.name = 'AbortError';
            reject(aborted);
          });
        }),
    );
    // Attach the handler before the timer fires, or the rejection lands unhandled.
    const settled = new StockNotifierHttpAdapter(makeConfig()).productChanged(change()).then(
      () => 'settled',
      () => 'settled',
    );
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await settled).toBe('settled');
    jest.useRealTimers();
  });

  // The catalog edit is already saved; a failed push must never surface as a failed save.
  it.each([
    ['non-2xx', () => fetchMock.mockResolvedValue({ ok: false, status: 502 } as unknown as Response)],
    ['an unreachable depot-service', () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))],
  ])('fails open (resolves) on %s', async (_label, arrange) => {
    arrange();
    await expect(
      new StockNotifierHttpAdapter(makeConfig()).productChanged(change()),
    ).resolves.toBeUndefined();
  });
});
