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
      loadAll: async () => [{ scope: 'GLOBAL', depotId: null, key: 'earnRateRupiah', value: '500' }],
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
