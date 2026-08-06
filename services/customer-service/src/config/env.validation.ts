import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

/** Boot-time env validation — fail fast on missing/malformed config. */
export const envValidationSchema = Joi.object({
  // One business timezone for the whole platform (H-16); see @hydromart/platform.
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  CUSTOMER_SERVICE_PORT: Joi.number().port().default(3002),
  CUSTOMER_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  MAX_ADDRESSES_PER_CUSTOMER: Joi.number().integer().positive().max(100).default(20),
  // Birthday promo (FR-091). Blank LOYALTY_SERVICE_URL = feature disabled (non-breaking).
  LOYALTY_SERVICE_URL: Joi.string().allow('').default(''),
  // Favourite catalog check. Blank = check skipped (unknown product ids are accepted).
  PRODUCT_SERVICE_URL: Joi.string().allow('').default(''),
  // auth-service base URL for pre-registering imported customers. Blank -> every import
  // row fails (503) rather than writing CRM data for an identity that doesn't exist.
  AUTH_SERVICE_URL: Joi.string().allow('').default(''),
  BIRTHDAY_REWARD_POINTS: Joi.number().integer().positive().default(250),
  // Shared service-to-service secret authenticating the birthday reward call to
  // loyalty. Blank = fail-closed (birthday sweep can't award, retries next run).
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  ORDER_SERVICE_URL: Joi.string().uri().allow('').default(''),
  CRM_NEW_DAYS: Joi.number().integer().positive().default(30),
  CRM_ACTIVE_DAYS: Joi.number().integer().positive().default(90),
  CRM_FOLLOWUP_DAYS: Joi.number().integer().positive().default(60),
  // Q-6: also from x-shared. The depot-scope resolver fails CLOSED on it, so an
  // unset value does not degrade tenant isolation — it refuses every scoped request.
  //
  // J-2 reads the same key for the directory's gallons-on-loan and deposit-held columns;
  // blank there means both render "belum tersambung" rather than a zero nobody checked.
  DEPOT_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
});
