import * as Joi from 'joi';

/** Boot-time env validation — fail fast on missing/malformed config. */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  CUSTOMER_SERVICE_PORT: Joi.number().port().default(3002),
  CUSTOMER_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  MAX_ADDRESSES_PER_CUSTOMER: Joi.number().integer().positive().max(100).default(20),
});
