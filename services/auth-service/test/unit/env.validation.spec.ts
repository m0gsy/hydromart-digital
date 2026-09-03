import { CONSOLE_ACK, envValidationSchema } from '../../src/config/env.validation';

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

  /*
   * The case production can actually produce, and the one the old schema let through.
   *
   * `docker-compose.prod.yml:107-110` interpolates these with `:-`, so the key is ALWAYS
   * present — which makes "absent", the one thing `.required()` catches, the one thing the
   * box cannot produce. And `.required()` on a base that `.allow('')` still admits `''`,
   * because a `when` branch is concat'ed and concat UNIONS allowed values; the channel
   * branch below already had to work around exactly this.
   *
   * Empty credentials booted GREEN and then failed at the first send, per customer, with
   * nothing upstream saying why.
   */
  it('refuses EMPTY Zenziva keys, not just absent ones', () => {
    const { error } = validate({
      ...BASE,
      OTP_DELIVERY_CHANNEL: 'zenziva',
      ZENZIVA_USERKEY: '',
      ZENZIVA_PASSKEY: '',
    });
    expect(error?.message).toContain('ZENZIVA_USERKEY');
  });

  it('refuses one empty key even when the other is set', () => {
    const { error } = validate({
      ...BASE,
      OTP_DELIVERY_CHANNEL: 'zenziva',
      ZENZIVA_USERKEY: 'userkey',
      ZENZIVA_PASSKEY: '',
    });
    expect(error?.message).toContain('ZENZIVA_PASSKEY');
  });

  // The sms channel had the identical hole.
  it('refuses an EMPTY sms token, not just an absent one', () => {
    const { error } = validate({
      ...BASE,
      OTP_DELIVERY_CHANNEL: 'sms',
      SMS_API_BASE_URL: 'https://sms.example',
      SMS_API_TOKEN: '',
    });
    expect(error?.message).toContain('SMS_API_TOKEN');
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

  // H-26: `console` prints the login code to the container log. Production must not boot on it.
  it('refuses the console channel in production', () => {
    const { error } = validate({
      ...BASE,
      NODE_ENV: 'production',
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com',
    });
    expect(error?.message).toContain('OTP_DELIVERY_CHANNEL');
  });

  it('accepts production once a real channel is named', () => {
    const { error } = validate({
      ...BASE,
      NODE_ENV: 'production',
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com',
      OTP_DELIVERY_CHANNEL: 'zenziva',
      ZENZIVA_USERKEY: 'userkey',
      ZENZIVA_PASSKEY: 'passkey',
    });
    expect(error).toBeUndefined();
  });

  // The E2E stack runs NODE_ENV=production on purpose and reads codes from the log.
  it('allows the console channel in production only with the explicit acknowledgement', () => {
    const env = {
      ...BASE,
      NODE_ENV: 'production',
      STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com',
      OTP_DELIVERY_CHANNEL: 'console',
    };
    expect(validate({ ...env, OTP_CONSOLE_ACK: CONSOLE_ACK }).error).toBeUndefined();
    expect(validate({ ...env, OTP_CONSOLE_ACK: 'true' }).error?.message).toContain(
      'OTP_DELIVERY_CHANNEL',
    );
  });

  it('rejects an unknown channel', () => {
    const { error } = validate({ ...BASE, OTP_DELIVERY_CHANNEL: 'carrier-pigeon' });
    expect(error?.message).toContain('OTP_DELIVERY_CHANNEL');
  });
});
