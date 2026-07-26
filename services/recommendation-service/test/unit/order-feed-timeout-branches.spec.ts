import { RecommendationConfigService } from '../../src/config/recommendation-config.service';
import { OrderFeedHttpAdapter } from '../../src/infrastructure/http/order-feed.http.adapter';

// Gap-fill: the 5s setTimeout(() => controller.abort()) callback — never fires in the
// happy-path specs because the mocked fetch settles synchronously. Fake timers drive it.

function makeConfig(): RecommendationConfigService {
  return { orderServiceUrl: 'http://order:3006', internalServiceKey: 'k' } as unknown as RecommendationConfigService;
}

describe('OrderFeedHttpAdapter timeout', () => {
  it('aborts the request and fails open when fetch outlasts the deadline', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn((_url: string, opts: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const promise = new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
      await jest.advanceTimersByTimeAsync(5_000);

      expect(await promise).toEqual({ orders: [], nextCursor: null });
    } finally {
      jest.useRealTimers();
    }
  });
});
