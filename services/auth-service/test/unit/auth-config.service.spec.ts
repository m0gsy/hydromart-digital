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

  it('returns the Google client id only when set', () => {
    expect(buildTestConfig().googleClientId).toBeUndefined();
    expect(buildTestConfig({ GOOGLE_OAUTH_CLIENT_ID: 'client-1' }).googleClientId).toBe('client-1');
  });

  it('exposes whatsapp/sms provider settings and environment flags', () => {
    const config = buildTestConfig({ NODE_ENV: 'production' });
    expect(config.isProduction).toBe(true);
    expect(config.port).toBe(3001);
    expect(config.otpPepper).toBe('test-otp-pepper-value');
    expect(config.whatsapp.template).toBe('hydromart_otp');
    expect(config.sms.senderId).toBe('HYDROMART');
  });
});
