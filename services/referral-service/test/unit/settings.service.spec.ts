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
    const repo = repoWith([{ scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '600' }]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    const out = await svc.schema(null);
    expect(out.effective.referrerPoints).toBe(600); // global override
    expect(out.effective.refereePoints).toBe(250); // env default
  });

  it('put validates against the registry min/max and refreshes the cache', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.put({ scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '700', updatedBy: 'u1' });
    expect(svc.cache.effective('referrerPoints', 'int', 500)).toBe(700);
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
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '999999', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('put rejects a prototype-inherited key like "constructor"', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'constructor', value: '1', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('put rejects a DEPOT scope for a global-only key', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'DEPOT', depotId: 'd1', key: 'referrerPoints', value: '600', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  it('reset rejects a DEPOT scope without depotId', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(svc.reset('DEPOT', null, 'referrerPoints')).rejects.toThrow();
  });

  it('reset removes a GLOBAL override so it falls back to the env default', async () => {
    const repo = repoWith([{ scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '600' }]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.reset('GLOBAL', null, 'referrerPoints');
    const out = await svc.schema(null);
    expect(out.effective.referrerPoints).toBe(500); // back to env default
  });
});
