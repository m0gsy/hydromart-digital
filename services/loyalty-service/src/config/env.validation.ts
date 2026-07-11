import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  LOYALTY_SERVICE_PORT: Joi.number().port().default(3009),
  LOYALTY_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  LOYALTY_EARN_RATE_RUPIAH: Joi.number().integer().positive().default(1000),
  LOYALTY_POINT_EXPIRY_MONTHS: Joi.number().integer().positive().default(12),
  // Shared service-to-service secret guarding /loyalty/earn + /loyalty/reward
  // (system-triggered). Blank = fail-closed (internal calls rejected).
  INTERNAL_SERVICE_KEY: Joi.string().allow('').default(''),
});
