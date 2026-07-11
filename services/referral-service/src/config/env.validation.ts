import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  REFERRAL_SERVICE_PORT: Joi.number().port().default(3011),
  REFERRAL_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  LOYALTY_SERVICE_URL: Joi.string().uri().required(),
  REFERRAL_REFERRER_POINTS: Joi.number().integer().positive().default(500),
  REFERRAL_REFEREE_POINTS: Joi.number().integer().positive().default(250),
  // Shared service-to-service secret: guards /referrals/qualify (order-service triggers
  // it) AND authenticates referral's own reward call to loyalty. Blank = fail-closed.
  INTERNAL_SERVICE_KEY: Joi.string().allow('').default(''),
});
