import { ConfigService } from '@nestjs/config';

import { CustomerConfigService } from '../../src/config/customer-config.service';
import { envValidationSchema } from '../../src/config/env.validation';

// Typed accessor over ConfigService: assert each getter reads the right key, applies
// the right default, and does the right coercion/trim. `get(key, default)` is modelled
// so the "missing → default" branches are exercised; `getOrThrow` backs the numeric ones.
function makeConfig(
  values: Record<string, unknown>,
  required: Record<string, unknown> = {},
): CustomerConfigService {
  const config = {
    get: jest.fn((key: string, def?: unknown) => (key in values ? values[key] : def)),
    getOrThrow: jest.fn((key: string) => required[key]),
  } as unknown as ConfigService;
  return new CustomerConfigService(config);
}

describe('CustomerConfigService', () => {
  it('nodeEnv/isProduction reflect NODE_ENV', () => {
    expect(makeConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
    const dev = makeConfig({ NODE_ENV: 'development' });
    expect(dev.nodeEnv).toBe('development');
    expect(dev.isProduction).toBe(false);
  });

  // SOP §7 agen photo storage. Same env names as depot/auth-service on purpose.
  it('reads the storage driver, local dir and public base url, trailing slash stripped', () => {
    const dflt = makeConfig({});
    expect(dflt.storageDriver).toBe('local');
    expect(dflt.storageLocalDir).toBe('./var/uploads');
    expect(dflt.storagePublicBaseUrl).toBe('http://localhost:3003');

    const s3 = makeConfig(
      {
        STORAGE_DRIVER: 's3',
        STORAGE_LOCAL_DIR: '/data/uploads',
        STORAGE_PUBLIC_BASE_URL: 'https://cdn.example/bucket//',
        STORAGE_S3_REGION: 'jkt-1',
      },
      {
        STORAGE_S3_ENDPOINT: 'https://nos.jkt-1.neo.id',
        STORAGE_S3_BUCKET: 'hydromart-customers',
        STORAGE_S3_ACCESS_KEY_ID: 'k',
        STORAGE_S3_SECRET_ACCESS_KEY: 's',
      },
    );
    expect(s3.storageDriver).toBe('s3');
    expect(s3.storageLocalDir).toBe('/data/uploads');
    // Stripped: the adapters join with '/' and a double slash breaks the object URL.
    expect(s3.storagePublicBaseUrl).toBe('https://cdn.example/bucket');
    expect(s3.s3).toEqual({
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'jkt-1',
      bucket: 'hydromart-customers',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
  });

  it('treats any STORAGE_DRIVER other than s3 as local', () => {
    expect(makeConfig({ STORAGE_DRIVER: 'nonsense' }).storageDriver).toBe('local');
  });

  it('nodeEnv falls back to the "development" default when unset', () => {
    expect(makeConfig({}).nodeEnv).toBe('development');
  });

  it('port/maxAddresses/rateLimit coerce required numeric config', () => {
    const c = makeConfig(
      {},
      {
        CUSTOMER_SERVICE_PORT: '3002',
        MAX_ADDRESSES_PER_CUSTOMER: '20',
        RATE_LIMIT_TTL_SECONDS: '60',
        RATE_LIMIT_MAX: '100',
      },
    );
    expect(c.port).toBe(3002);
    expect(c.maxAddresses).toBe(20);
    expect(c.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
  });

  it('corsOrigins splits, trims, and drops empties', () => {
    expect(
      makeConfig({ CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com ,' }).corsOrigins,
    ).toEqual(['http://a.com', 'http://b.com']);
  });

  it('loyaltyServiceUrl/orderServiceUrl/authServiceUrl are trimmed', () => {
    const c = makeConfig({
      LOYALTY_SERVICE_URL: '  http://loyalty  ',
      ORDER_SERVICE_URL: ' http://order ',
      AUTH_SERVICE_URL: ' http://auth ',
    });
    expect(c.loyaltyServiceUrl).toBe('http://loyalty');
    expect(c.orderServiceUrl).toBe('http://order');
    expect(c.authServiceUrl).toBe('http://auth');
  });

  // K4.2: blank means the agen price notice is dropped; the change still applies and is
  // still audited, so this getter must not be allowed to turn whitespace into a URL.
  it('crmServiceUrl is trimmed and blank by default', () => {
    expect(makeConfig({ CRM_SERVICE_URL: '  http://crm:3012 ' }).crmServiceUrl).toBe(
      'http://crm:3012',
    );
    expect(makeConfig({ CRM_SERVICE_URL: '   ' }).crmServiceUrl).toBe('');
    expect(makeConfig({}).crmServiceUrl).toBe('');
  });

  it('birthdayRewardPoints/internalServiceKey read their keys', () => {
    const c = makeConfig({ INTERNAL_SERVICE_KEY: 'secret' }, { BIRTHDAY_REWARD_POINTS: '250' });
    expect(c.birthdayRewardPoints).toBe(250);
    expect(c.internalServiceKey).toBe('secret');
  });

  it('crmThresholds coerce numbers and apply policy defaults when unset', () => {
    expect(makeConfig({}).crmThresholds).toEqual({ newDays: 30, activeDays: 30, followUpDays: 60 });
    expect(
      makeConfig({ CRM_NEW_DAYS: '7', CRM_ACTIVE_DAYS: '14', CRM_FOLLOWUP_DAYS: '45' })
        .crmThresholds,
    ).toEqual({ newDays: 7, activeDays: 14, followUpDays: 45 });
  });
});

describe('envValidationSchema', () => {
  const valid = {
    CUSTOMER_DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('accepts a minimal valid env and applies defaults', () => {
    const { error, value } = envValidationSchema.validate(valid);
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.CUSTOMER_SERVICE_PORT).toBe(3002);
    expect(value.MAX_ADDRESSES_PER_CUSTOMER).toBe(20);
  });

  it('rejects a missing database url', () => {
    const { error } = envValidationSchema.validate({ JWT_ACCESS_SECRET: 'x'.repeat(32) });
    expect(error).toBeDefined();
  });
});
