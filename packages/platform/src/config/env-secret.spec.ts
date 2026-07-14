import * as Joi from 'joi';

import { optionalSecret, requiredSecret } from './env-secret';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  JWT_ACCESS_SECRET: requiredSecret(32),
  INTERNAL_SERVICE_KEY: optionalSecret(16),
});

const GOOD = 'k'.repeat(40);
const PLACEHOLDER = 'change-me-access-secret-min-32-chars-long';

describe('requiredSecret', () => {
  it('rejects a dev placeholder in production', () => {
    const { error } = schema.validate({ NODE_ENV: 'production', JWT_ACCESS_SECRET: PLACEHOLDER });
    expect(error?.message).toMatch(/JWT_ACCESS_SECRET/);
  });

  it('accepts a strong value in production', () => {
    const { error } = schema.validate({ NODE_ENV: 'production', JWT_ACCESS_SECRET: GOOD });
    expect(error).toBeUndefined();
  });

  it('allows the placeholder outside production (dev convenience)', () => {
    const { error } = schema.validate({ NODE_ENV: 'development', JWT_ACCESS_SECRET: PLACEHOLDER });
    expect(error).toBeUndefined();
  });

  it('still fails when missing', () => {
    const { error } = schema.validate({ NODE_ENV: 'development' });
    expect(error?.message).toMatch(/JWT_ACCESS_SECRET/);
  });
});

describe('optionalSecret', () => {
  it('allows blank in production (feature disabled)', () => {
    const { error } = schema.validate({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: GOOD,
      INTERNAL_SERVICE_KEY: '',
    });
    expect(error).toBeUndefined();
  });

  it('rejects a dev placeholder in production when set', () => {
    const { error } = schema.validate({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: GOOD,
      INTERNAL_SERVICE_KEY: 'change-me-internal-service-key',
    });
    expect(error?.message).toMatch(/INTERNAL_SERVICE_KEY/);
  });
});
