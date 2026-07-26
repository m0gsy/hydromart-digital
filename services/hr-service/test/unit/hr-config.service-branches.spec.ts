import { ConfigService } from '@nestjs/config';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { HrConfigService } from '../../src/config/hr-config.service';

// Gap-fill for hr-config.service: the getters/tunables the primary spec never touches —
// env-present vs default fallback, geofence parsing, face/order/neo/storage/s3 blocks.

class FakeSource {
  constructor(private readonly rows: SettingRow[]) {}
  async loadAll(): Promise<SettingRow[]> {
    return this.rows;
  }
}

function config(env: Record<string, string> = {}): ConfigService {
  return {
    get: <T>(k: string, d?: T) => (env[k] ?? d) as T,
    getOrThrow: (k: string) => {
      if (env[k] == null) throw new Error(`missing ${k}`);
      return env[k];
    },
  } as unknown as ConfigService;
}

async function cacheWith(rows: SettingRow[] = []): Promise<SettingsCache> {
  const c = new SettingsCache(new FakeSource(rows));
  await c.refresh();
  return c;
}

const depotId = '22222222-2222-2222-2222-222222222222';

describe('HrConfigService — env-driven getters', () => {
  it('reads nodeEnv / isProduction (default + production)', async () => {
    const dev = new HrConfigService(config(), await cacheWith());
    expect(dev.nodeEnv).toBe('development');
    expect(dev.isProduction).toBe(false);

    const prod = new HrConfigService(config({ NODE_ENV: 'production' }), await cacheWith());
    expect(prod.nodeEnv).toBe('production');
    expect(prod.isProduction).toBe(true);
  });

  it('returns the configured time zone (and its default)', async () => {
    expect(new HrConfigService(config(), await cacheWith()).timeZone).toBe('Asia/Jakarta');
    expect(new HrConfigService(config({ PRICING_TZ: 'UTC' }), await cacheWith()).timeZone).toBe('UTC');
  });

  it('reads face-recognition settings straight from ENV (with defaults)', async () => {
    const svc = new HrConfigService(
      config({
        FACE_VERIFIER_DRIVER: 'stub',
        HR_FACE_MATCH_THRESHOLD: '0.7',
        HR_FACE_DUPLICATE_THRESHOLD: '0.8',
        HR_FACE_MODEL_PATH: '/models/x.onnx',
        FACE_SERVICE_URL: 'http://face:9000',
      }),
      await cacheWith(),
    );
    expect(svc.faceVerifierDriver).toBe('stub');
    expect(svc.faceMatchThreshold).toBeCloseTo(0.7);
    expect(svc.faceDuplicateThreshold).toBeCloseTo(0.8);
    expect(svc.faceModelPath).toBe('/models/x.onnx');
    expect(svc.faceServiceUrl).toBe('http://face:9000');

    const defaults = new HrConfigService(config({ HR_FACE_MATCH_THRESHOLD: '0.5', HR_FACE_DUPLICATE_THRESHOLD: '0.5' }), await cacheWith());
    expect(defaults.faceVerifierDriver).toBe('onnx');
    expect(defaults.faceModelPath).toBe('./models/arcface.onnx');
    expect(defaults.faceServiceUrl).toBe('');
  });

  it('exposes the order-service block (configured + empty defaults)', async () => {
    const wired = new HrConfigService(
      config({ ORDER_SERVICE_URL: 'http://order:3010', INTERNAL_SERVICE_KEY: 'k' }),
      await cacheWith(),
    );
    expect(wired.orderService).toEqual({ url: 'http://order:3010', internalKey: 'k' });
    expect(new HrConfigService(config(), await cacheWith()).orderService).toEqual({ url: '', internalKey: '' });
  });

  it('exposes the NEO FR block (configured + defaults)', async () => {
    const wired = new HrConfigService(
      config({ NEO_FR_ENDPOINT: 'https://fr.test', NEO_FR_TOKEN: 't', NEO_FR_GALLERY_ID: 'g' }),
      await cacheWith(),
    );
    expect(wired.neoFr).toEqual({ endpoint: 'https://fr.test', token: 't', galleryId: 'g' });
    expect(new HrConfigService(config(), await cacheWith()).neoFr).toEqual({
      endpoint: 'https://fr.neoapi.id',
      token: '',
      galleryId: 'hydromart-hr',
    });
  });

  it('exposes storage driver / public base url / s3 block (configured + defaults)', async () => {
    const wired = new HrConfigService(
      config({
        STORAGE_DRIVER: 's3',
        STORAGE_PUBLIC_BASE_URL: 'https://cdn.test',
        STORAGE_S3_REGION: 'ap-southeast-1',
        STORAGE_S3_ENDPOINT: 'https://s3.test',
        STORAGE_S3_BUCKET: 'hr',
        STORAGE_S3_ACCESS_KEY_ID: 'AK',
        STORAGE_S3_SECRET_ACCESS_KEY: 'SK',
      }),
      await cacheWith(),
    );
    expect(wired.storageDriver).toBe('s3');
    expect(wired.storagePublicBaseUrl).toBe('https://cdn.test');
    expect(wired.s3).toEqual({
      region: 'ap-southeast-1',
      endpoint: 'https://s3.test',
      bucket: 'hr',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
    });

    const defaults = new HrConfigService(config(), await cacheWith());
    expect(defaults.storageDriver).toBe('disabled');
    expect(defaults.storagePublicBaseUrl).toBe('');
    expect(defaults.s3.region).toBe('auto');
    expect(defaults.s3.bucket).toBe('');
  });
});

describe('HrConfigService — per-depot tunables', () => {
  const ENV = {
    HR_LATE_TOLERANCE_MINUTES: '15',
    HR_DAILY_RATE_TRAINING_IDR: '30000',
    HR_ABSENCE_DEDUCTION_IDR: '0',
  };

  it('reads lateTolerance / dailyRateTraining / absenceDeduction from env when no override', async () => {
    const svc = new HrConfigService(config(ENV), await cacheWith());
    expect(svc.lateToleranceMinutes()).toBe(15);
    expect(svc.dailyRateTraining()).toBe(30000);
    expect(svc.absenceDeductionAmount()).toBe(0);
  });

  it('honors per-depot overrides for those tunables', async () => {
    const cache = await cacheWith([
      { scope: 'DEPOT', depotId, key: 'lateToleranceMinutes', value: '30' },
      { scope: 'DEPOT', depotId, key: 'dailyRateTraining', value: '45000' },
    ]);
    const svc = new HrConfigService(config(ENV), cache);
    expect(svc.lateToleranceMinutes(depotId)).toBe(30);
    expect(svc.dailyRateTraining(depotId)).toBe(45000);
    expect(svc.lateToleranceMinutes()).toBe(15); // no depot → env
  });

  it('reads weeklyOffDays and tenureRaiseLadder (env default + override)', async () => {
    const envd = new HrConfigService(config({ HR_WEEKLY_OFF_DAYS: '0,6', HR_TENURE_RAISE_LADDER: '1:5,2:10' }), await cacheWith());
    expect(envd.weeklyOffDays()).toBe('0,6');
    expect(envd.tenureRaiseLadder()).toBe('1:5,2:10');

    const empty = new HrConfigService(config(), await cacheWith());
    expect(empty.weeklyOffDays()).toBe('');
    expect(empty.tenureRaiseLadder()).toBe('');

    const over = new HrConfigService(
      config(),
      await cacheWith([{ scope: 'GLOBAL', depotId: null, key: 'weeklyOffDays', value: '0' }]),
    );
    expect(over.weeklyOffDays()).toBe('0');
  });

  it('parses a fully-set geofence', async () => {
    const cache = await cacheWith([
      { scope: 'DEPOT', depotId, key: 'geofenceLat', value: '-6.2001' },
      { scope: 'DEPOT', depotId, key: 'geofenceLng', value: '106.8123' },
      { scope: 'DEPOT', depotId, key: 'geofenceRadiusM', value: '150' },
    ]);
    const svc = new HrConfigService(config(), cache);
    expect(svc.geofence(depotId)).toEqual({ lat: -6.2001, lng: 106.8123, radiusM: 150 });
  });

  it('returns null lat/lng and 0 radius for an unset geofence (blank + non-finite → null)', async () => {
    const svc = new HrConfigService(config(), await cacheWith());
    expect(svc.geofence()).toEqual({ lat: null, lng: null, radiusM: 0 });

    const bad = new HrConfigService(
      config(),
      await cacheWith([{ scope: 'GLOBAL', depotId: null, key: 'geofenceLat', value: 'not-a-number' }]),
    );
    expect(bad.geofence().lat).toBeNull();
  });
});
