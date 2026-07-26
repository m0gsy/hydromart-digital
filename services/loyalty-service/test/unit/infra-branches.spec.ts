import { SettingsCache } from '@hydromart/platform';

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CustomerDirectoryHttpAdapter } from '../../src/infrastructure/http/customer-directory.http.adapter';
import { LoyaltyConfigService } from '../../src/config/loyalty-config.service';
import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsRepository } from '../../src/application/ports/settings.repository';

describe('PrismaService lifecycle', () => {
  it('connects on init and disconnects on destroy', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined);
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined as never);

    await svc.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);

    await svc.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('CustomerDirectoryHttpAdapter timeout', () => {
  it('aborts the request after the timeout and fails open with []', async () => {
    jest.useFakeTimers();
    // fetch that only settles when its abort signal fires (never on its own).
    const fetchMock = jest.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const config = { customerServiceUrl: 'http://customer:3002', internalServiceKey: 'k' } as unknown as LoyaltyConfigService;

    const promise = new CustomerDirectoryHttpAdapter(config).customerIdsForDepot('d1');
    await jest.advanceTimersByTimeAsync(5000); // fires the setTimeout(() => controller.abort())

    expect(await promise).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe('SettingsService additional branches', () => {
  function repoWith(): { repo: SettingsRepository; upserts: unknown[] } {
    const store: (import('@hydromart/platform').SettingRow & { updatedBy: string })[] = [];
    const upserts: unknown[] = [];
    return {
      upserts,
      repo: {
        loadAll: async () => store.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value })),
        upsert: async (row) => {
          upserts.push(row);
          store.push(row);
        },
        remove: async () => undefined,
      },
    };
  }

  it('put rejects a value below the registry min', async () => {
    const { repo } = repoWith();
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'earnRateRupiah', value: '0', updatedBy: 'u1' }),
    ).rejects.toThrow(/below min/);
  });

  it('put persists a DEPOT override with the given depotId', async () => {
    const { repo, upserts } = repoWith();
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.put({ scope: 'DEPOT', depotId: 'd1', key: 'earnRateRupiah', value: '1500', updatedBy: 'u2' });
    expect(upserts[0]).toMatchObject({ scope: 'DEPOT', depotId: 'd1', key: 'earnRateRupiah', value: '1500', updatedBy: 'u2' });
  });
});
