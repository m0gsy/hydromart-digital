import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  ORDER_SERVICE_PORT: Joi.number().port().default(3004),
  ORDER_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  PRODUCT_SERVICE_URL: Joi.string().uri().required(),
  DEPOT_SERVICE_URL: Joi.string().uri().required(),
  LOYALTY_SERVICE_URL: Joi.string().uri().required(),
  PROMO_SERVICE_URL: Joi.string().uri().required(),
  REFERRAL_SERVICE_URL: Joi.string().uri().required(),
  CRM_SERVICE_URL: Joi.string().uri().required(),
  ORDER_DELIVERY_FEE: Joi.number().min(0).default(5000),
  // Age (minutes) after which an unconfirmed CREATED order is treated as abandoned
  // and can be auto-cancelled (releasing its stock hold). Company policy default.
  ORDER_ABANDON_MINUTES: Joi.number().integer().positive().default(60),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
});
