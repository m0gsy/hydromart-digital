import * as Joi from 'joi';

/**
 * Shared boot-time guards for secret env vars (JWT keys, webhook secrets, OTP
 * pepper, internal service keys). Single source of truth so the dev-placeholder
 * rule can't drift between services.
 *
 * The sentinel `change-me` is used throughout `.env.example`. In production any
 * secret still containing it is rejected, so a copied dev config fails the boot
 * validation instead of silently shipping a publicly-known secret.
 */
const DEV_PLACEHOLDER = /change-me/i;

/**
 * A required secret. Always present + at least `minLength`. In production it
 * additionally must not be a dev placeholder.
 */
export function requiredSecret(minLength: number): Joi.StringSchema {
  return Joi.string()
    .min(minLength)
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().pattern(DEV_PLACEHOLDER, { name: 'devPlaceholder', invert: true }),
    });
}

/**
 * An optional shared secret (blank = feature disabled, e.g. INTERNAL_SERVICE_KEY).
 * Blank stays allowed in every environment. When set in production it must meet
 * `minLength` and must not be a dev placeholder.
 */
export function optionalSecret(minLength: number): Joi.StringSchema {
  return Joi.string()
    .allow('')
    .default('')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .allow('')
        .min(minLength)
        .pattern(DEV_PLACEHOLDER, { name: 'devPlaceholder', invert: true }),
    });
}
