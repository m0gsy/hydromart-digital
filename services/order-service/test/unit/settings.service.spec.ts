import { SettingsCache, SettingRow, SettingsSliceService } from '@hydromart/platform';
import { SettingsService } from '../../src/application/services/settings.service';
import { SettingsRepository } from '../../src/application/ports/settings.repository';
import { SETTING_DEFS } from '../../src/config/setting-defs';

function repoWith(rows: SettingRow[]): SettingsRepository {
  const store = [...rows] as (SettingRow & { updatedBy: string })[];
  return {
    loadAll: async () =>
      store.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value })),
    upsert: async (row) => {
      const i = store.findIndex(
        (r) => r.scope === row.scope && r.depotId === row.depotId && r.key === row.key,
      );
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
    // Two keys on purpose: one overridden, one untouched — the point is that the schema
    // mixes stored values with env defaults rather than answering from one source.
    const repo = repoWith([
      { scope: 'GLOBAL', depotId: null, key: 'subscriptionDiscountPct', value: '9' },
    ]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    const out = await svc.schema(null);
    expect(out.effective.subscriptionDiscountPct).toBe(9); // global override
    expect(out.effective.abandonMinutes).toBe(60); // env default
  });

  it('put validates against the registry min/max and refreshes the cache', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.put({
      scope: 'GLOBAL',
      depotId: null,
      key: 'abandonMinutes',
      value: '90',
      updatedBy: 'u1',
    });
    expect(svc.cache.effective('abandonMinutes', 'int', 60)).toBe(90);
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
      svc.put({
        scope: 'GLOBAL',
        depotId: null,
        key: 'abandonMinutes',
        value: '999999',
        updatedBy: 'u1',
      }),
    ).rejects.toThrow();
  });

  /**
   * C13 removed `deliveryFee`, which was this registry's ONLY `global: true` key — so the
   * global-only guard no longer has a subject in order-service's own defs.
   *
   * The guard still exists and still matters (other slices declare global-only keys), so it
   * is tested against a synthetic registry rather than deleted. Deleting it would have left
   * a rule enforced by nothing, which is exactly how a guard stops being one.
   */
  it('put rejects a DEPOT override on a global-only key', async () => {
    const repo = repoWith([]);
    const defs = [
      { key: 'onlyGlobal', label: 'x', type: 'int' as const, min: 0, max: 10, envDefault: 1, global: true },
    ];
    // The base constructor is protected — a slice is meant to declare its own defs, which
    // is exactly what this stand-in does.
    class OnlyGlobalSlice extends SettingsSliceService {
      constructor() {
        super(repo, new SettingsCache(repo), defs, { onlyGlobal: defs[0] });
      }
    }
    const svc = new OnlyGlobalSlice();
    await expect(
      svc.put({
        scope: 'DEPOT',
        depotId: '11111111-1111-1111-1111-111111111111',
        key: 'onlyGlobal',
        value: '2',
        updatedBy: 'u1',
      }),
    ).rejects.toThrow();
  });

  // Inverted by D1. C13 removed order-service's last global-only key, and this test pinned
  // that absence — so the guard above had to be exercised against a synthetic registry.
  // D1's `subscriptionSweepExempt` brings a real one back (the sweep has no depot scope, so
  // a per-depot override would be a lever moving nothing), which lets the guard be asserted
  // against the registry that actually ships.
  it('rejects a DEPOT override for the real global-only key (D1)', async () => {
    expect(SETTING_DEFS.filter((d) => d.global).map((d) => d.key)).toEqual([
      'subscriptionSweepExempt',
    ]);
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({
        scope: 'DEPOT',
        depotId: '11111111-1111-1111-1111-111111111111',
        key: 'subscriptionSweepExempt',
        value: '0',
        updatedBy: 'u1',
      }),
    ).rejects.toThrow();
  });

  it('put rejects a prototype-inherited key like "constructor"', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'GLOBAL', depotId: null, key: 'constructor', value: '1', updatedBy: 'u1' }),
    ).rejects.toThrow();
  });

  // The global-only half of this moved to its own test above, against a synthetic registry:
  // C13 removed the last global-only key order-service had.
  it('put rejects a DEPOT scope without depotId', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(
      svc.put({ scope: 'DEPOT', depotId: null, key: 'abandonMinutes', value: '1', updatedBy: 'u1' }),
    ).rejects.toThrow(/depotId required/);
  });

  it('reset rejects a DEPOT scope without depotId', async () => {
    const repo = repoWith([]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await expect(svc.reset('DEPOT', null, 'abandonMinutes')).rejects.toThrow();
  });

  it('reset removes an override so it falls back', async () => {
    const repo = repoWith([{ scope: 'DEPOT', depotId: 'd1', key: 'abandonMinutes', value: '90' }]);
    const svc = new SettingsService(repo, new SettingsCache(repo));
    await svc.reset('DEPOT', 'd1', 'abandonMinutes');
    const out = await svc.schema('d1');
    expect(out.effective.abandonMinutes).toBe(60); // back to env default
  });
});
