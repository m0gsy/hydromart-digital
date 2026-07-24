import { SettingsCache, SettingRow } from '@hydromart/platform';
import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsRepository } from '../../src/application/ports/settings.repository';

function repoWith(rows: SettingRow[]): SettingsRepository {
  const store = [...rows] as (SettingRow & { updatedBy: string })[];
  return {
    loadAll: async () => store.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value })),
    upsert: async (row) => {
      const i = store.findIndex((r) => r.scope === row.scope && r.depotId === row.depotId && r.key === row.key);
      if (i >= 0) store[i] = row;
      else store.push(row);
    },
    remove: async (scope, depotId, key) => {
      const i = store.findIndex((r) => r.scope === scope && r.depotId === depotId && r.key === key);
      if (i >= 0) store.splice(i, 1);
    },
  };
}

describe('SettingsService', () => {
  it('schema returns effective values with env-default fallback', async () => {
    const repo = repoWith([{ scope: 'GLOBAL', depotId: null, key: 'earnRateRupiah', value: '500' }]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    const out = await svc.schema(null);
    expect(out.effective.earnRateRupiah).toBe(500); // global override
    expect(out.effective.pointExpiryMonths).toBe(12); // env default
  });

  it('put validates against the registry min/max and refreshes the cache', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.put({ scope: 'GLOBAL', depotId: null, key: 'earnRateRupiah', value: '2000', updatedBy: 'u1' });
    expect(svc.cache.effective('earnRateRupiah', 'money', 1000)).toBe(2000);
  });

  it('put rejects a DEPOT scope without depotId', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'DEPOT', depotId: null, key: 'earnRateRupiah', value: '500', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('put rejects an unknown key', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'nope', value: '1', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('put rejects an out-of-range value', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'pointExpiryMonths', value: '999', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('put rejects a prototype-inherited key like "constructor"', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'constructor', value: '1', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('reset rejects a DEPOT scope without depotId', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(svc.reset('DEPOT', null, 'earnRateRupiah')).rejects.toThrow();
  });

  it('reset removes an override so it falls back', async () => {
    const repo = repoWith([{ scope: 'DEPOT', depotId: 'd1', key: 'earnRateRupiah', value: '500' }]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.reset('DEPOT', 'd1', 'earnRateRupiah');
    const out = await svc.schema('d1');
    expect(out.effective.earnRateRupiah).toBe(1000); // back to env default
  });
});
