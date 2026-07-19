import { ConfigService } from '@nestjs/config';

import { ProductConfigService } from '../../src/config/product-config.service';

describe('ProductConfigService', () => {
  function make(store: Record<string, string>): ProductConfigService {
    const config = {
      get: <T>(key: string, def?: T) => (key in store ? (store[key] as unknown as T) : def),
      getOrThrow: <T>(key: string) => {
        if (!(key in store)) throw new Error(`missing ${key}`);
        return store[key] as unknown as T;
      },
    } as unknown as ConfigService;
    return new ProductConfigService(config);
  }

  it('returns defaults when keys are absent', () => {
    const svc = make({});
    expect(svc.nodeEnv).toBe('development');
    expect(svc.isProduction).toBe(false);
    expect(svc.corsOrigins).toEqual(['http://localhost:3000']);
    expect(svc.storageLocalDir).toBe('./var/uploads');
    expect(svc.storagePublicBaseUrl).toBe('http://localhost:3003');
    expect(svc.storageDriver).toBe('local');
  });

  it('reads and coerces configured values', () => {
    const svc = make({
      NODE_ENV: 'production',
      PRODUCT_SERVICE_PORT: '3003',
      CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com ,',
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com///',
      STORAGE_DRIVER: 's3',
      RATE_LIMIT_TTL_SECONDS: '30',
      RATE_LIMIT_MAX: '50',
    });
    expect(svc.isProduction).toBe(true);
    expect(svc.port).toBe(3003);
    expect(svc.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
    expect(svc.storagePublicBaseUrl).toBe('https://cdn.example.com');
    expect(svc.storageDriver).toBe('s3');
    expect(svc.rateLimit).toEqual({ ttlSeconds: 30, limit: 50 });
  });

  it('assembles the s3 config, applying the region default', () => {
    const svc = make({
      STORAGE_S3_ENDPOINT: 'https://nos.jkt-1.neo.id',
      STORAGE_S3_BUCKET: 'hydromart-products',
      STORAGE_S3_ACCESS_KEY_ID: 'key',
      STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(svc.s3).toEqual({
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'auto',
      bucket: 'hydromart-products',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
  });

  it('throws via getOrThrow when a required numeric key is missing', () => {
    expect(() => make({}).port).toThrow('missing PRODUCT_SERVICE_PORT');
  });
});
