import { buildTestConfig } from '../support/fakes';

describe('AuthConfigService', () => {
  it('exposes typed OTP and token policies', () => {
    const config = buildTestConfig();
    expect(config.otpPolicy).toEqual({
      ttlSeconds: 300,
      length: 6,
      maxAttempts: 5,
      resendCooldownSeconds: 60,
    });
    expect(config.tokenPolicy.accessTtlSeconds).toBe(900);
    expect(config.tokenPolicy.refreshTtlSeconds).toBe(2592000);
  });

  it('parses CORS origins into a trimmed list', () => {
    const config = buildTestConfig({
      CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com ,',
    });
    expect(config.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });

  it('reports the delivery channel and rate limit', () => {
    const config = buildTestConfig({ OTP_DELIVERY_CHANNEL: 'sms' });
    expect(config.otpDeliveryChannel).toBe('sms');
    expect(config.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
  });

  it('returns the Google client id only when set', () => {});

  // Blank fails the invite rather than creating half a person — the getter is what the
  // fail-closed check reads, so an empty pair has to come back as an empty pair.
  it('reports the hr-service invite target, blank when unset', () => {
    expect(buildTestConfig().hrDirectory).toEqual({ hrUrl: '', internalKey: '' });
    expect(
      buildTestConfig({ HR_SERVICE_URL: 'http://hr:3018', INTERNAL_SERVICE_KEY: 'k' }).hrDirectory,
    ).toEqual({ hrUrl: 'http://hr:3018', internalKey: 'k' });
  });

  it('exposes sms provider settings and environment flags', () => {
    const config = buildTestConfig({ NODE_ENV: 'production' });
    expect(config.isProduction).toBe(true);
    expect(config.port).toBe(3001);
    expect(config.otpPepper).toBe('test-otp-pepper-value');
    expect(config.sms.senderId).toBe('HYDROMART');
  });
});
