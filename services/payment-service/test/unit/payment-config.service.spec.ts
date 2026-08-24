import { envValidationSchema } from '../../src/config/env.validation';
import { buildTestConfig } from '../support/fakes';

// PaymentConfigService is thin but branchy: trailing-slash stripping, the
// refund-threshold fallback, and CORS list parsing all have edge cases.
describe('PaymentConfigService', () => {
  it('exposes the parsed non-secret settings', () => {
    const config = buildTestConfig();
    expect(config.nodeEnv).toBe('test');
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3005);
    expect(config.webhookSecret).toBe('test-webhook-secret-01');
    expect(config.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
  });

  it('reports production when NODE_ENV is production', () => {
    expect(buildTestConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });

  it('strips trailing slashes from gateway and order-service URLs', () => {
    const config = buildTestConfig({
      PAYMENT_GATEWAY_BASE_URL: 'https://gw.example.com//',
      ORDER_SERVICE_URL: 'https://orders.example.com/',
    });
    expect(config.gatewayBaseUrl).toBe('https://gw.example.com');
    expect(config.orderServiceUrl).toBe('https://orders.example.com');
  });

  it('reads the gateway key and internal service key', () => {
    const config = buildTestConfig({
      PAYMENT_GATEWAY_API_KEY: 'gw-key',
      INTERNAL_SERVICE_KEY: 'svc-key',
    });
    expect(config.gatewayApiKey).toBe('gw-key');
    expect(config.internalServiceKey).toBe('svc-key');
  });

  describe('refundApprovalThreshold', () => {
    it('defaults to Rp 100k when unset', () => {
      expect(buildTestConfig().refundApprovalThreshold).toBe(100_000);
    });
    it('uses a valid positive override', () => {
      expect(buildTestConfig({ REFUND_HQ_THRESHOLD: '250000' }).refundApprovalThreshold).toBe(
        250_000,
      );
    });
    it('falls back to the default for a non-positive or non-numeric value', () => {
      expect(buildTestConfig({ REFUND_HQ_THRESHOLD: '0' }).refundApprovalThreshold).toBe(100_000);
      expect(buildTestConfig({ REFUND_HQ_THRESHOLD: 'abc' }).refundApprovalThreshold).toBe(100_000);
    });
  });

  it('parses CORS origins into a trimmed, non-empty list', () => {
    const config = buildTestConfig({
      CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test ,,',
    });
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });
});

/*
 * K2.1b · the storage accessors. Reading them is the whole of what the S3 adapter does at
 * construction time, and a typo in any one of the five keys is a service that boots fine
 * and then loses every receipt a customer uploads.
 */
describe('PaymentConfigService — storage', () => {
  it('defaults to the local-disk driver and trims a trailing slash off the base URL', () => {
    const config = buildTestConfig({ STORAGE_PUBLIC_BASE_URL: 'https://cdn.example///' });
    expect(config.storageDriver).toBe('local');
    expect(config.storageLocalDir).toBe('./var/uploads');
    expect(config.storagePublicBaseUrl).toBe('https://cdn.example');
  });

  // Not storage, but the same class of accessor and the last one nothing read: an empty
  // DEPOT_SERVICE_URL leaves every counter payment unattributed to a drawer (C2).
  it('trims the depot service URL and tolerates it being unset', () => {
    expect(buildTestConfig({ DEPOT_SERVICE_URL: 'http://depot:3007/' }).depotServiceUrl).toBe(
      'http://depot:3007',
    );
    expect(buildTestConfig().depotServiceUrl).toBe('');
  });

  it('reads the five S3 keys when the driver is s3', () => {
    const config = buildTestConfig({
      STORAGE_DRIVER: 's3',
      STORAGE_S3_ENDPOINT: 'https://nos.jkt-1.neo.id',
      STORAGE_S3_REGION: 'jkt-1',
      STORAGE_S3_BUCKET: 'hydromart',
      STORAGE_S3_ACCESS_KEY_ID: 'k',
      STORAGE_S3_SECRET_ACCESS_KEY: 's',
    });
    expect(config.storageDriver).toBe('s3');
    expect(config.s3).toEqual({
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'jkt-1',
      bucket: 'hydromart',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
  });
});

// H-25: SEC-1 (the client-supplied amount check) is skipped whenever
// ORDER_SERVICE_URL or INTERNAL_SERVICE_KEY is blank. Production must not be
// able to boot into that state.
describe('envValidationSchema — SEC-1 coordination keys', () => {
  const base = {
    PAYMENT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    PAYMENT_WEBHOOK_SECRET: 'b'.repeat(16),
  };

  it('lets development run with the order callback disabled', () => {
    const { error, value } = envValidationSchema.validate(base);
    expect(error).toBeUndefined();
    expect(value.ORDER_SERVICE_URL).toBe('');
    expect(value.INTERNAL_SERVICE_KEY).toBe('');
  });

  // Q-6 made two more keys production-required, so a production env needs them
  // present or the assertion below would pass for the wrong reason.
  const prod = {
    ...base,
    NODE_ENV: 'production',
    AUTH_SERVICE_URL: 'http://auth:3001',
    DEPOT_SERVICE_URL: 'http://depot:3007',
    // K2.1b: a production boot must name a real public origin for payment proofs — a
    // localhost value would bake an unreachable URL into the one record a payment dispute
    // is settled from, which is why the schema refuses it rather than defaulting.
    STORAGE_PUBLIC_BASE_URL: 'https://nos.jkt-1.neo.id/hydromart',
  };

  it.each([
    ['ORDER_SERVICE_URL', { INTERNAL_SERVICE_KEY: 'c'.repeat(16) }],
    ['INTERNAL_SERVICE_KEY', { ORDER_SERVICE_URL: 'http://order:3004' }],
  ])('refuses to boot production without %s', (missing, present) => {
    const { error } = envValidationSchema.validate({
      ...prod,
      ...present,
    });
    expect(error?.message).toContain(missing);
  });

  it('refuses a production value that is explicitly blank', () => {
    const { error } = envValidationSchema.validate({
      ...prod,
      ORDER_SERVICE_URL: '',
      INTERNAL_SERVICE_KEY: '',
    });
    expect(error).toBeDefined();
  });

  it('accepts production with both set', () => {
    const { error } = envValidationSchema.validate({
      ...prod,
      ORDER_SERVICE_URL: 'http://order:3004',
      INTERNAL_SERVICE_KEY: 'c'.repeat(16),
    });
    expect(error).toBeUndefined();
  });
});
