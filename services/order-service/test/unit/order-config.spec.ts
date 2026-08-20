import { ConfigService } from '@nestjs/config';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { OrderConfigService } from '../../src/config/order-config.service';

function cacheWith(rows: SettingRow[]): SettingsCache {
  return new SettingsCache({ loadAll: async () => rows });
}

describe('OrderConfigService with settings cache', () => {
  const env = new ConfigService({
    ORDER_ABANDON_MINUTES: '60',
    ORDER_SUBSCRIPTION_DISCOUNT_PCT: '5',
  } as never);

  // C13 removed `deliveryFee` — a key with zero callers. These exercise the RESOLUTION
  // machinery (depot beats global beats env), so they use a key that still has one.
  it('returns depot override when present', async () => {
    const cache = cacheWith([{ scope: 'DEPOT', depotId: 'd1', key: 'subscriptionDiscountPct', value: '9' }]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.subscriptionDiscountRate('d1')).toBeCloseTo(0.09);
  });

  it('falls back to env when no override', async () => {
    const cache = cacheWith([]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.subscriptionDiscountRate('d1')).toBeCloseTo(0.05);
    expect(cfg.subscriptionDiscountRate()).toBeCloseTo(0.05);
  });

  it('a global override applies to every depot; a depot override wins over it', async () => {
    const cache = cacheWith([
      { scope: 'GLOBAL', depotId: null, key: 'subscriptionDiscountPct', value: '7' },
      { scope: 'DEPOT', depotId: 'd1', key: 'subscriptionDiscountPct', value: '9' },
    ]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.subscriptionDiscountRate('d1')).toBeCloseTo(0.09);
    expect(cfg.subscriptionDiscountRate('d2')).toBeCloseTo(0.07);
    expect(cfg.subscriptionDiscountRate()).toBeCloseTo(0.07);
  });

  it('abandonMinutes resolves a GLOBAL override (no per-depot caller exists)', async () => {
    const cache = cacheWith([
      { scope: 'GLOBAL', depotId: null, key: 'abandonMinutes', value: '30' },
    ]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.abandonMinutes).toBe(30);
  });

  it('subscriptionDiscountRate turns whole-percent settings into a fraction, per depot', async () => {
    const cache = cacheWith([
      { scope: 'DEPOT', depotId: 'd1', key: 'subscriptionDiscountPct', value: '8' },
      { scope: 'DEPOT', depotId: 'd2', key: 'subscriptionDiscountPct', value: '0' },
    ]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.subscriptionDiscountRate('d1')).toBe(0.08);
    // A depot that funds no subscription discount at all is a legitimate setting, not
    // a missing one: 0 must survive rather than fall through to the env 5%.
    expect(cfg.subscriptionDiscountRate('d2')).toBe(0);
    expect(cfg.subscriptionDiscountRate('d3')).toBe(0.05);
  });

  it('an empty cache preserves every business getter at its exact env value', async () => {
    const cache = cacheWith([]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.abandonMinutes).toBe(60);
    expect(cfg.subscriptionDiscountRate()).toBe(0.05);
  });
});

/**
 * C11: whether a depot will deliver a sale rung up at its own counter. Per-depot because
 * the answer is operational — a depot whose only courier is already out cannot promise it.
 */
describe('OrderConfigService · counterDelivery', () => {
  const env = new ConfigService({
    ORDER_ABANDON_MINUTES: '60',
    ORDER_SUBSCRIPTION_DISCOUNT_PCT: '5',
    ORDER_COUNTER_DELIVERY: '1',
  } as never);

  it('is on by default, for a named depot and for none', async () => {
    const cache = cacheWith([]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.counterDelivery('d1')).toBe(true);
    expect(cfg.counterDelivery()).toBe(true);
  });

  it('one depot can switch it off without touching the others', async () => {
    const cache = cacheWith([{ scope: 'DEPOT', depotId: 'd1', key: 'counterDelivery', value: '0' }]);
    await cache.refresh();
    const cfg = new OrderConfigService(env, cache);
    expect(cfg.counterDelivery('d1')).toBe(false);
    expect(cfg.counterDelivery('d2')).toBe(true);
  });
});
