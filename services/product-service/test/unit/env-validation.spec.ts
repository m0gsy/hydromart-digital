import { envValidationSchema } from '../../src/config/env.validation';

describe('envValidationSchema', () => {
  const base = {
    PRODUCT_DATABASE_URL: 'postgres://user:pass@localhost:5432/hydromart',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('applies defaults for optional keys', () => {
    const { error, value } = envValidationSchema.validate(base);
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PRODUCT_SERVICE_PORT).toBe(3003);
    expect(value.STORAGE_LOCAL_DIR).toBe('./var/uploads');
    expect(value.STORAGE_PUBLIC_BASE_URL).toBe('http://localhost:3003');
    expect(value.STORAGE_DRIVER).toBe('local');
    expect(value.STORAGE_S3_REGION).toBe('auto');
    expect(value.RATE_LIMIT_TTL_SECONDS).toBe(60);
    expect(value.RATE_LIMIT_MAX).toBe(100);
  });

  it('requires PRODUCT_DATABASE_URL and a 32-char JWT secret', () => {
    expect(envValidationSchema.validate({ JWT_ACCESS_SECRET: 'x'.repeat(32) }).error).toBeDefined();
    expect(
      envValidationSchema.validate({ ...base, JWT_ACCESS_SECRET: 'short' }).error,
    ).toBeDefined();
  });

  it('requires the S3 keys when STORAGE_DRIVER is s3', () => {
    const { error } = envValidationSchema.validate({ ...base, STORAGE_DRIVER: 's3' });
    expect(error).toBeDefined();

    const { error: ok } = envValidationSchema.validate({
      ...base,
      STORAGE_DRIVER: 's3',
      STORAGE_S3_ENDPOINT: 'https://nos.jkt-1.neo.id',
      STORAGE_S3_BUCKET: 'hydromart-products',
      STORAGE_S3_ACCESS_KEY_ID: 'key',
      STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(ok).toBeUndefined();
  });

  it('rejects a localhost public base URL in production', () => {
    const { error } = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'production',
      STORAGE_PUBLIC_BASE_URL: 'http://localhost:3003',
    });
    expect(error).toBeDefined();
  });
});
