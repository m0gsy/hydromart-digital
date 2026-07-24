import { ConfigService } from '@nestjs/config';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { OrderConfigService } from '../../src/config/order-config.service';

function cacheWith(rows: SettingRow[]): SettingsCache {
  return new SettingsCache({ loadAll: async () => rows });
}

describe('OrderConfigService with settings cache', () => {
  const env = new ConfigService({ ORDER_DELIVERY_FEE: '1000', ORDER_ABANDON_MINUTES: '60' } as never);

  it('returns depot override when present', async () => {
    const cache = cacheWith([{ scope: 'DEPOT', depotId: 'd1', key: 'deliveryFee', value: '2500' }]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.deliveryFee('d1')).toBe(2500);
  });

  it('falls back to env when no override', async () => {
    const cache = cacheWith([]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.deliveryFee('d1')).toBe(1000);
    expect(cfg.deliveryFee()).toBe(1000);
  });

  it('a global override applies to every depot; a depot override wins over it', async () => {
    const cache = cacheWith([
      { scope: 'GLOBAL', depotId: null, key: 'deliveryFee', value: '1500' },
      { scope: 'DEPOT', depotId: 'd1', key: 'deliveryFee', value: '2500' },
    ]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.deliveryFee('d1')).toBe(2500);
    expect(cfg.deliveryFee('d2')).toBe(1500);
    expect(cfg.deliveryFee()).toBe(1500);
  });

  it('abandonMinutes resolves a GLOBAL override (no per-depot caller exists)', async () => {
    const cache = cacheWith([{ scope: 'GLOBAL', depotId: null, key: 'abandonMinutes', value: '30' }]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.abandonMinutes).toBe(30);
  });

  it('an empty cache preserves every business getter at its exact env value', async () => {
    const cache = cacheWith([]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.deliveryFee()).toBe(1000);
    expect(cfg.abandonMinutes).toBe(60);
  });
});
