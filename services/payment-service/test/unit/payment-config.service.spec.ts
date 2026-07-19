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
      expect(buildTestConfig({ REFUND_HQ_THRESHOLD: '250000' }).refundApprovalThreshold).toBe(250_000);
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
