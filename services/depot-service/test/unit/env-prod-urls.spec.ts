import { envValidationSchema } from '../../src/config/env.validation';

// D1-07/D1-08: these URLs are what lets the depot console close shifts, read costs and validate stock lines. Blank was ACCEPTED in production,
// where the service then booted "healthy" and every call to the missing peer failed, quietly.
// docker-compose.prod.yml sets all of them for this service, so requiring them costs nothing.
describe('production env: peer service URLs', () => {
  const complained = (env: Record<string, string>): string[] =>
    (
      envValidationSchema.validate(env, { abortEarly: false, allowUnknown: true }).error?.details ??
      []
    ).map((d) => String(d.path[0]));

  it.each(['PAYMENT_SERVICE_URL', 'DELIVERY_SERVICE_URL', 'ORDER_SERVICE_URL'])(
    'requires %s in production',
    (key) => {
      expect(complained({ NODE_ENV: 'production' })).toContain(key);
      expect(complained({ NODE_ENV: 'production', [key]: '' })).toContain(key);
    },
  );

  it.each(['PAYMENT_SERVICE_URL', 'DELIVERY_SERVICE_URL', 'ORDER_SERVICE_URL'])(
    'accepts %s when it is set in production',
    (key) => {
      expect(complained({ NODE_ENV: 'production', [key]: 'http://peer:3000' })).not.toContain(key);
    },
  );

  it.each(['PAYMENT_SERVICE_URL', 'DELIVERY_SERVICE_URL', 'ORDER_SERVICE_URL'])(
    '%s may stay blank outside production (a laptop runs one service)',
    (key) => {
      expect(complained({ NODE_ENV: 'development', [key]: '' })).not.toContain(key);
    },
  );

  // D1-07: PRODUCT_SERVICE_URL is optional (blank = no catalog validation), but its default must
  // not be localhost in production, where that points at nothing.
  it('PRODUCT_SERVICE_URL: defaults to blank in production and refuses localhost there', () => {
    const ok = envValidationSchema.validate(
      { NODE_ENV: 'production' },
      { abortEarly: false, allowUnknown: true },
    );
    expect(ok.value.PRODUCT_SERVICE_URL).toBe('');
    expect(
      complained({ NODE_ENV: 'production', PRODUCT_SERVICE_URL: 'http://localhost:3003' }),
    ).toContain('PRODUCT_SERVICE_URL');
    expect(
      complained({ NODE_ENV: 'production', PRODUCT_SERVICE_URL: 'http://product:3003' }),
    ).not.toContain('PRODUCT_SERVICE_URL');
    expect(
      envValidationSchema.validate(
        { NODE_ENV: 'development' },
        { abortEarly: false, allowUnknown: true },
      ).value.PRODUCT_SERVICE_URL,
    ).toBe('http://localhost:3003');
  });
});
