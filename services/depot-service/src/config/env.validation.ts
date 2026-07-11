import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  DEPOT_SERVICE_PORT: Joi.number().port().default(3007),
  DEPOT_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // Low-stock alerting via crm-service (optional; blank disables the feature).
  CRM_SERVICE_URL: Joi.string().uri().allow('').default(''),
  DEPOT_ALERT_PHONE: Joi.string().allow('').default(''),
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  // Shared service-to-service secret authenticating the low-stock alert call to crm's
  // internal notification endpoint. Blank = alerting disabled (fail-open).
  INTERNAL_SERVICE_KEY: Joi.string().allow('').default(''),
});
