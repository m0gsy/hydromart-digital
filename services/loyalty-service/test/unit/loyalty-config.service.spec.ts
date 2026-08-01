import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { LoyaltyConfigService } from '../../src/config/loyalty-config.service';

function config(cache: SettingsCache): LoyaltyConfigService {
  const env: Record<string, string> = {
    LOYALTY_EARN_RATE_RUPIAH: '1000',
    LOYALTY_POINT_EXPIRY_MONTHS: '12',
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => env[k],
  };
  return new LoyaltyConfigService(fake as unknown as ConfigService, cache);
}

describe('LoyaltyConfigService business tunables', () => {
  it('falls back to the ENV default when no override exists and no depot is given', () => {
    const svc = config(new SettingsCache({ loadAll: async () => [] }));
    expect(svc.earnRateRupiah()).toBe(1000);
    expect(svc.pointExpiryMonths()).toBe(12);
  });

  it('applies a GLOBAL override for every depot', async () => {
    const cache = new SettingsCache({
      loadAll: async () => [
        { scope: 'GLOBAL', depotId: null, key: 'earnRateRupiah', value: '500' },
      ],
    });
    await cache.refresh();
    const svc = config(cache);
    expect(svc.earnRateRupiah('depot-1')).toBe(500);
  });

  it('a DEPOT override wins over the GLOBAL override for that depot only', async () => {
    const cache = new SettingsCache({
      loadAll: async () => [
        { scope: 'GLOBAL', depotId: null, key: 'pointExpiryMonths', value: '6' },
        { scope: 'DEPOT', depotId: 'depot-1', key: 'pointExpiryMonths', value: '3' },
      ],
    });
    await cache.refresh();
    const svc = config(cache);
    expect(svc.pointExpiryMonths('depot-1')).toBe(3);
    expect(svc.pointExpiryMonths('depot-2')).toBe(6);
  });
});

describe('LoyaltyConfigService membership ladder', () => {
  const ladder = (svc: LoyaltyConfigService, depotId: string | null = null) =>
    Object.fromEntries(svc.tierBenefits(depotId).map((b) => [b.tier, b]));

  it('defaults to the domain table — no ENV keys of its own', () => {
    const svc = config(new SettingsCache({ loadAll: async () => [] }));
    expect(ladder(svc)).toMatchObject({
      REGULAR: { threshold: 0, discountRate: 0 },
      SILVER: { threshold: 1000, discountRate: 0.02 },
      GOLD: { threshold: 5000, discountRate: 0.05 },
      PLATINUM: { threshold: 15000, discountRate: 0.08 },
    });
  });

  it('lets one depot move both the threshold and the rate of a rung', async () => {
    const cache = new SettingsCache({
      loadAll: async () => [
        { scope: 'DEPOT', depotId: 'depot-1', key: 'goldThreshold', value: '9000' },
        { scope: 'DEPOT', depotId: 'depot-1', key: 'goldDiscountPct', value: '3' },
      ],
    });
    await cache.refresh();
    const svc = config(cache);
    expect(ladder(svc, 'depot-1').GOLD).toMatchObject({ threshold: 9000, discountRate: 0.03 });
    // Untouched depots and the global ladder keep the default rung.
    expect(ladder(svc, 'depot-2').GOLD).toMatchObject({ threshold: 5000, discountRate: 0.05 });
    expect(ladder(svc).GOLD).toMatchObject({ threshold: 5000, discountRate: 0.05 });
  });

  it('stores whole percent and hands the domain a fraction', async () => {
    const cache = new SettingsCache({
      loadAll: async () => [
        { scope: 'GLOBAL', depotId: null, key: 'platinumDiscountPct', value: '12' },
      ],
    });
    await cache.refresh();
    expect(ladder(config(cache)).PLATINUM.discountRate).toBe(0.12);
  });

  it('never lets a depot tune REGULAR — it is the floor', async () => {
    const cache = new SettingsCache({
      loadAll: async () => [
        { scope: 'DEPOT', depotId: 'depot-1', key: 'regularDiscountPct', value: '20' },
      ],
    });
    await cache.refresh();
    expect(ladder(config(cache), 'depot-1').REGULAR).toMatchObject({
      threshold: 0,
      discountRate: 0,
    });
  });
});
