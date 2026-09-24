import * as Joi from 'joi';

import { internalServiceKey, optionalSecret, requiredSecret } from './env-secret';

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

/*
 * CORE-4: the shared service-to-service key was `optionalSecret` in fifteen services and a
 * bare `Joi.string().allow('')` in hr-service, so blank booted everywhere. Blank makes the
 * internal guard fail closed — which sounds safe and is not: retention sweeps, PDP erasure
 * fan-out and counter-sale resolution all quietly stop, each looking like a feature nobody
 * wired rather than a secret nobody set.
 */
describe('internalServiceKey', () => {
  const schema = Joi.object({
    NODE_ENV: Joi.string().default('development'),
    INTERNAL_SERVICE_KEY: internalServiceKey(),
  });

  it('lets a development box boot without one', () => {
    expect(schema.validate({ INTERNAL_SERVICE_KEY: '' }).error).toBeUndefined();
    expect(schema.validate({}).error).toBeUndefined();
  });

  it('refuses a production boot with none', () => {
    const { error } = schema.validate({ NODE_ENV: 'production', INTERNAL_SERVICE_KEY: '' });
    expect(error?.message).toMatch(/INTERNAL_SERVICE_KEY/);
  });

  it('refuses a production boot with the dev placeholder or a short key', () => {
    expect(
      schema.validate({
        NODE_ENV: 'production',
        INTERNAL_SERVICE_KEY: 'change-me-internal-service-key',
      }).error?.message,
    ).toMatch(/INTERNAL_SERVICE_KEY/);
    expect(
      schema.validate({ NODE_ENV: 'production', INTERNAL_SERVICE_KEY: 'short' }).error?.message,
    ).toMatch(/INTERNAL_SERVICE_KEY/);
  });

  it('accepts a real key in production', () => {
    expect(
      schema.validate({
        NODE_ENV: 'production',
        INTERNAL_SERVICE_KEY: 'b7f3c2a9d1e84f60a5c7b8d9e0f1a2b3',
      }).error,
    ).toBeUndefined();
  });
});
