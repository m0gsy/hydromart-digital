import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  FORECAST_SERVICE_PORT: Joi.number().port().default(3014),
  FORECAST_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  INTERNAL_SERVICE_KEY: Joi.string().allow('').default(''),
  // order-service base URL; used later for the completed-orders rebuild feed.
  ORDER_SERVICE_URL: Joi.string().uri().allow('').default(''),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
});
