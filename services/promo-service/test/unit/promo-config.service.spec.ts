import { ConfigService } from '@nestjs/config';

import { PromoConfigService } from '../../src/config/promo-config.service';

function makeConfig(env: Record<string, string> = {}): PromoConfigService {
  return new PromoConfigService(new ConfigService(env));
}

describe('PromoConfigService — storage getters (promo banner upload)', () => {
  it('defaults to local-disk storage with a local upload dir and base URL', () => {
    const config = makeConfig();
    expect(config.storageDriver).toBe('local');
    expect(config.storageLocalDir).toBe('./var/uploads');
    expect(config.storagePublicBaseUrl).toBe('http://localhost:3010');
  });

  it('strips a trailing slash off the public base URL', () => {
    const config = makeConfig({ STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/' });
    expect(config.storagePublicBaseUrl).toBe('https://cdn.example.com');
  });

  it('treats anything other than "s3" as the local driver', () => {
    expect(makeConfig({ STORAGE_DRIVER: 'local' }).storageDriver).toBe('local');
    expect(makeConfig({ STORAGE_DRIVER: 'weird' }).storageDriver).toBe('local');
    expect(makeConfig({ STORAGE_DRIVER: 's3' }).storageDriver).toBe('s3');
  });

  it('reads the full S3 config block, defaulting the region to "auto"', () => {
    const config = makeConfig({
      STORAGE_S3_ENDPOINT: 'https://nos.jkt-1.neo.id',
      STORAGE_S3_BUCKET: 'hydromart-auth',
      STORAGE_S3_ACCESS_KEY_ID: 'k',
      STORAGE_S3_SECRET_ACCESS_KEY: 's',
    });
    expect(config.s3).toEqual({
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'auto',
      bucket: 'hydromart-auth',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
  });

  it('throws reading `s3` when a required key is missing — a driver=s3 misconfiguration', () => {
    expect(() => makeConfig().s3).toThrow();
  });
});
