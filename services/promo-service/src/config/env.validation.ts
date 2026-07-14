import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PROMO_SERVICE_PORT: Joi.number().port().default(3010),
  PROMO_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // Shared service-to-service secret guarding /vouchers/redeem (system-triggered by
  // order-service at checkout). Blank = fail-closed (internal calls rejected).
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  // Outbound targets for the voucher-grant notification (spec 7b/5h). Blank = grant
  // still succeeds; the "voucher baru" notification is skipped (fail-open).
  CRM_SERVICE_URL: Joi.string().uri().allow('').default(''),
  CUSTOMER_SERVICE_URL: Joi.string().uri().allow('').default(''),
});
