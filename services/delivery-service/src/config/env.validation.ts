import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  DELIVERY_SERVICE_PORT: Joi.number().port().default(3006),
  DELIVERY_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  ORDER_SERVICE_URL: Joi.string().uri().required(),
  MAX_ACTIVE_DELIVERIES_PER_DRIVER: Joi.number().integer().positive().default(1),
  DELIVERY_SLA_MINUTES: Joi.number().integer().positive().default(120),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
});
