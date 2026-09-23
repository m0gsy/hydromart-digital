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
 * CORE-4 — the shared service-to-service key, which is NOT optional in production.
 *
 * It was declared with `optionalSecret` in fifteen services and with a bare
 * `Joi.string().allow('')` in hr-service, so blank booted everywhere. Blank means the
 * internal guard fails closed — which sounds safe and is not: it silently disables
 * retention sweeps, PDP erasure fan-out, counter-sale resolution and every other
 * service-to-service path, and each of those fails in a way that reads like a feature
 * nobody wired rather than a secret nobody set.
 *
 * Blank stays fine in development (a laptop runs one service at a time). Production must
 * name it.
 */
export function internalServiceKey(minLength = 16): Joi.StringSchema {
  return (
    Joi.string()
      .default('')
      .when('NODE_ENV', {
        is: 'production',
        // `invalid('')` matters: Joi CONCATENATES the branch onto the base, so a base
        // `.allow('')` would survive into production and keep letting blank through —
        // which is the shape of the defect this function exists to close.
        then: Joi.string()
          .min(minLength)
          .required()
          .invalid('')
          .pattern(DEV_PLACEHOLDER, { name: 'devPlaceholder', invert: true }),
        otherwise: Joi.string().allow(''),
      })
  );
}

/**
 * An optional shared secret (blank = feature disabled, e.g. a third-party webhook secret).
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
