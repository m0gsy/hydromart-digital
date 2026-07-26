import { buildTestConfig } from '../support/fakes';

/**
 * Gap-fill: exercises every DeliveryConfigService getter (URLs, storage, s3, rate
 * limit) plus its ternary/replace branches, which the behaviour-focused specs never
 * touch. Pure delegation to ConfigService — no I/O.
 */
describe('DeliveryConfigService getters', () => {
  it('trims trailing slashes off the required service URLs', () => {
    const cfg = buildTestConfig({
      ORDER_SERVICE_URL: 'http://order:3004///',
      DEPOT_SERVICE_URL: 'http://depot:3007/',
      PAYMENT_SERVICE_URL: 'http://pay:3005//',
    });
    expect(cfg.orderServiceUrl).toBe('http://order:3004');
    expect(cfg.depotServiceUrl).toBe('http://depot:3007');
    expect(cfg.paymentServiceUrl).toBe('http://pay:3005');
  });

  it('treats blank optional integration URLs/keys as disabled', () => {
    const cfg = buildTestConfig();
    expect(cfg.crmServiceUrl).toBe('');
    expect(cfg.payoutServiceUrl).toBe('');
    expect(cfg.internalServiceKey).toBe('');
    expect(cfg.opsAlertPhone).toBe('');
  });

  it('trims configured optional integration URLs when present', () => {
    const cfg = buildTestConfig({
      CRM_SERVICE_URL: 'http://crm:3009/',
      PAYOUT_SERVICE_URL: 'http://payout:3010//',
      INTERNAL_SERVICE_KEY: 'k-123',
      OPS_ALERT_PHONE: '628123',
    });
    expect(cfg.crmServiceUrl).toBe('http://crm:3009');
    expect(cfg.payoutServiceUrl).toBe('http://payout:3010');
    expect(cfg.internalServiceKey).toBe('k-123');
    expect(cfg.opsAlertPhone).toBe('628123');
  });

  it('exposes port, node env, and the production flag', () => {
    const dev = buildTestConfig();
    expect(dev.port).toBe(3006);
    expect(dev.nodeEnv).toBe('test');
    expect(dev.isProduction).toBe(false);
    const prod = buildTestConfig({ NODE_ENV: 'production' });
    expect(prod.isProduction).toBe(true);
  });

  it('parses CORS origins, dropping blanks, and the rate-limit tuple', () => {
    const cfg = buildTestConfig({
      CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test , ,',
      RATE_LIMIT_TTL_SECONDS: '30',
      RATE_LIMIT_MAX: '50',
    });
    expect(cfg.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(cfg.rateLimit).toEqual({ ttlSeconds: 30, limit: 50 });
  });

  it('defaults the storage driver to local and can switch to s3', () => {
    expect(buildTestConfig().storageDriver).toBe('local');
    expect(buildTestConfig({ STORAGE_DRIVER: 'local' }).storageDriver).toBe('local');
    expect(buildTestConfig({ STORAGE_DRIVER: 's3' }).storageDriver).toBe('s3');
  });

  it('exposes local storage dir + trimmed public base url', () => {
    const cfg = buildTestConfig({
      STORAGE_LOCAL_DIR: '/data/uploads',
      STORAGE_PUBLIC_BASE_URL: 'http://cdn.test/',
    });
    expect(cfg.storageLocalDir).toBe('/data/uploads');
    expect(cfg.storagePublicBaseUrl).toBe('http://cdn.test');
  });

  it('builds the s3 config from the required + defaulted env keys', () => {
    const cfg = buildTestConfig({
      STORAGE_S3_ENDPOINT: 'http://minio:9000',
      STORAGE_S3_BUCKET: 'pod',
      STORAGE_S3_ACCESS_KEY_ID: 'ak',
      STORAGE_S3_SECRET_ACCESS_KEY: 'sk',
    });
    expect(cfg.s3).toEqual({
      endpoint: 'http://minio:9000',
      region: 'auto',
      bucket: 'pod',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
    });
  });

  it('resolves the per-depot business tunables (env fallback)', () => {
    const cfg = buildTestConfig();
    expect(cfg.maxActiveDeliveriesPerDriver('d1')).toBe(1);
    expect(cfg.shiftCheckInRadiusMeters('d1')).toBe(200);
    expect(cfg.shiftBreakQuotaMinutes('d1')).toBe(30);
    expect(cfg.noShowMinContactAttempts('d1')).toBe(2);
    expect(cfg.noShowMinWaitSeconds('d1')).toBe(300);
    expect(cfg.slaMinutes('d1')).toBe(120);
    expect(cfg.courierWeeklyTarget('d1')).toBe(45);
    expect(cfg.courierRatePerDeliveryIdr('d1')).toBe(12000);
    expect(cfg.podRetentionDays).toBe(365);
  });
});
