import { ConfigService } from '@nestjs/config';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { DeliveryConfigService } from '../../src/config/delivery-config.service';

function cacheWith(rows: SettingRow[]): SettingsCache {
  return new SettingsCache({ loadAll: async () => rows });
}

describe('DeliveryConfigService with settings cache', () => {
  const env = new ConfigService({ SHIFT_LENGTH_HOURS: '8' } as never);

  it('returns depot override when present', async () => {
    const cache = cacheWith([{ scope: 'DEPOT', depotId: 'd1', key: 'shiftLengthHours', value: '6' }]);
    await cache.refresh();
    const cfg = new DeliveryConfigService(env, cache);
    expect(cfg.shiftLengthHours('d1')).toBe(6);
  });

  it('falls back to env when no override', async () => {
    const cache = cacheWith([]);
    await cache.refresh();
    const cfg = new DeliveryConfigService(env, cache);
    expect(cfg.shiftLengthHours('d1')).toBe(8);
    expect(cfg.shiftLengthHours()).toBe(8);
  });

  it('a global override applies to every depot; a depot override wins over it', async () => {
    const cache = cacheWith([
      { scope: 'GLOBAL', depotId: null, key: 'shiftCheckInRadiusMeters', value: '250' },
      { scope: 'DEPOT', depotId: 'd1', key: 'shiftCheckInRadiusMeters', value: '80' },
    ]);
    await cache.refresh();
    const cfg = new DeliveryConfigService(
      new ConfigService({ SHIFT_CHECKIN_RADIUS_M: '200' } as never),
      cache,
    );
    expect(cfg.shiftCheckInRadiusMeters('d1')).toBe(80);
    expect(cfg.shiftCheckInRadiusMeters('d2')).toBe(250);
    expect(cfg.shiftCheckInRadiusMeters()).toBe(250);
  });

  it('an empty cache preserves every business getter at its exact env value', async () => {
    const env2 = new ConfigService({
      MAX_ACTIVE_DELIVERIES_PER_DRIVER: '1',
      SHIFT_CHECKIN_RADIUS_M: '200',
      SHIFT_LENGTH_HOURS: '8',
      SHIFT_BREAK_QUOTA_MINUTES: '30',
      NO_SHOW_MIN_CONTACT_ATTEMPTS: '2',
      NO_SHOW_MIN_WAIT_SECONDS: '300',
      DELIVERY_SLA_MINUTES: '120',
      COURIER_WEEKLY_TARGET: '45',
      POD_RETENTION_DAYS: '365',
    } as never);
    const cache = cacheWith([]);
    await cache.refresh();
    const cfg = new DeliveryConfigService(env2, cache);
    expect(cfg.maxActiveDeliveriesPerDriver()).toBe(1);
    expect(cfg.shiftCheckInRadiusMeters()).toBe(200);
    expect(cfg.shiftLengthHours()).toBe(8);
    expect(cfg.shiftBreakQuotaMinutes()).toBe(30);
    expect(cfg.noShowMinContactAttempts()).toBe(2);
    expect(cfg.noShowMinWaitSeconds()).toBe(300);
    expect(cfg.slaMinutes()).toBe(120);
    expect(cfg.urbanSpeedKmph()).toBe(18);
    expect(cfg.courierWeeklyTarget()).toBe(45);
    expect(cfg.courierRatePerDeliveryIdr()).toBe(12000);
    expect(cfg.podRetentionDays).toBe(365);
  });
});
