import { ConfigService } from '@nestjs/config';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { HrConfigService } from '../../src/config/hr-config.service';

class FakeSource {
  constructor(private readonly rows: SettingRow[]) {}
  async loadAll(): Promise<SettingRow[]> {
    return this.rows;
  }
}

const ENV: Record<string, string> = {
  HR_SERVICE_PORT: '3018',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX: '100',
  HR_WORK_START_TIME: '08:00',
  HR_LATE_TOLERANCE_MINUTES: '15',
  HR_LATE_DEDUCTION_IDR: '10000',
  HR_DAILY_RATE_TRAINING_IDR: '30000',
  HR_ABSENCE_DEDUCTION_IDR: '0',
  HR_STANDARD_WORKING_MINUTES: '480',
  HR_FACE_MATCH_THRESHOLD: '0.62',
  HR_FACE_DUPLICATE_THRESHOLD: '0.75',
};

function config(overrides: Record<string, string> = {}): ConfigService {
  const env = { ...ENV, ...overrides };
  return {
    get: <T>(k: string, d?: T) => (env[k] ?? d) as T,
    getOrThrow: (k: string) => {
      if (env[k] == null) throw new Error(`missing ${k}`);
      return env[k];
    },
  } as unknown as ConfigService;
}

async function cacheWith(rows: SettingRow[]): Promise<SettingsCache> {
  const c = new SettingsCache(new FakeSource(rows));
  await c.refresh();
  return c;
}

const depotId = '11111111-1111-1111-1111-111111111111';

describe('HrConfigService', () => {
  it('reads scalar config from ENV', () => {
    const svc = new HrConfigService(config(), new SettingsCache(new FakeSource([])));
    expect(svc.port).toBe(3018);
    expect(svc.faceMatchThreshold).toBeCloseTo(0.62);
    expect(svc.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
  });

  it('falls through to ENV defaults with no overrides', async () => {
    const svc = new HrConfigService(config(), await cacheWith([]));
    expect(svc.lateDeductionAmount()).toBe(10000);
    expect(svc.workStartTime()).toBe('08:00');
    expect(svc.standardWorkingMinutes()).toBe(480);
  });

  it('honors a per-depot override', async () => {
    const cache = await cacheWith([
      { scope: 'DEPOT', depotId, key: 'lateDeductionAmount', value: '20000' },
      { scope: 'GLOBAL', depotId: null, key: 'workStartTime', value: '07:30' },
    ]);
    const svc = new HrConfigService(config(), cache);
    expect(svc.lateDeductionAmount(depotId)).toBe(20000);
    expect(svc.lateDeductionAmount()).toBe(10000); // no depot → global absent → env
    expect(svc.workStartTime()).toBe('07:30'); // global override applies network-wide
  });

  it('parses corsOrigins into a trimmed list', () => {
    const svc = new HrConfigService(
      config({ CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com ' }),
      new SettingsCache(new FakeSource([])),
    );
    expect(svc.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });
});
