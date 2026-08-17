import { ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ForecastConfigService } from '../../src/config/forecast-config.service';
import { OrderFeedHttpAdapter } from '../../src/infrastructure/http/order-feed.http.adapter';
import { DepotOwnershipHttpAdapter } from '../../src/infrastructure/http/depot-ownership.http.adapter';

describe('PrismaService lifecycle', () => {
  it('connects on init and disconnects on destroy', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined);
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined);

    await svc.onModuleInit();
    await svc.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

// The 5s AbortController timeout callback (`() => controller.abort()`) only runs when the
// request outlives TIMEOUT_MS. Fake timers + a fetch that rejects on abort drive that branch.
function config(): ForecastConfigService {
  return {
    orderServiceUrl: 'http://order:3005',
    depotServiceUrl: 'http://depot:3007',
    internalServiceKey: 'k', forecastModelForDepot: () => 'heuristic' } as unknown as ForecastConfigService;
}

function hangingFetchThatRejectsOnAbort(): jest.Mock {
  return jest.fn((_url: string, opts: { signal: AbortSignal }) => {
    return new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  });
}

describe('HTTP adapter request timeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('OrderFeed fails open when the request times out (abort fires)', async () => {
    global.fetch = hangingFetchThatRejectsOnAbort() as unknown as typeof fetch;
    const promise = new OrderFeedHttpAdapter(config()).fetchCompleted(null, 50);
    await Promise.resolve(); // let fetch register its abort listener
    jest.advanceTimersByTime(5_000); // triggers () => controller.abort()
    await expect(promise).resolves.toEqual({ orders: [], nextCursor: null });
  });

  it('DepotOwnership fails closed when the request times out (abort fires)', async () => {
    global.fetch = hangingFetchThatRejectsOnAbort() as unknown as typeof fetch;
    const promise = new DepotOwnershipHttpAdapter(config()).ownedDepotIds('owner-1');
    const assertion = expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
    await Promise.resolve();
    jest.advanceTimersByTime(5_000);
    await assertion;
  });
});
