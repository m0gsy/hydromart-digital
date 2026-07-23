import { envValidationSchema } from '../../src/config/env.validation';

// Minimum a deploy must supply; everything else in the schema carries a default.
const BASE = {
  AUTH_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-1',
  OTP_PEPPER: 'test-otp-pepper-value',
};

function validate(env: Record<string, string>) {
  return envValidationSchema.validate(env, { allowUnknown: true, abortEarly: false });
}

describe('auth env validation — OTP channel credentials', () => {
  // Regression: a Joi key is optional by default, so `valid('sms')` in the `when`
  // condition was also satisfied by OTP_DELIVERY_CHANNEL being absent — CI (which
  // ships no .env) then had every channel's credentials demanded at once.
  it('requires no channel credentials when OTP_DELIVERY_CHANNEL is absent', () => {
    expect(validate({ ...BASE }).error).toBeUndefined();
  });

  it('defaults the channel to console', () => {
    expect(validate({ ...BASE }).value.OTP_DELIVERY_CHANNEL).toBe('console');
  });

  it('requires the Zenziva keys when that channel is selected', () => {
    const { error } = validate({ ...BASE, OTP_DELIVERY_CHANNEL: 'zenziva' });
    expect(error?.message).toContain('ZENZIVA_USERKEY');
    expect(error?.message).toContain('ZENZIVA_PASSKEY');
  });

  it('accepts the Zenziva channel once both keys are present', () => {
    const { error } = validate({
      ...BASE,
      OTP_DELIVERY_CHANNEL: 'zenziva',
      ZENZIVA_USERKEY: 'userkey',
      ZENZIVA_PASSKEY: 'passkey',
    });
    expect(error).toBeUndefined();
  });

  it('requires the generic SMS gateway credentials when that channel is selected', () => {
    const { error } = validate({ ...BASE, OTP_DELIVERY_CHANNEL: 'sms' });
    expect(error?.message).toContain('SMS_API_BASE_URL');
  });

  it('rejects an unknown channel', () => {
    const { error } = validate({ ...BASE, OTP_DELIVERY_CHANNEL: 'carrier-pigeon' });
    expect(error?.message).toContain('OTP_DELIVERY_CHANNEL');
  });
});
