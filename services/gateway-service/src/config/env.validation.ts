import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  GATEWAY_PORT: Joi.number().port().default(8080),
  AUTH_SERVICE_URL: Joi.string().uri().required(),
  CUSTOMER_SERVICE_URL: Joi.string().uri().required(),
  PRODUCT_SERVICE_URL: Joi.string().uri().required(),
  ORDER_SERVICE_URL: Joi.string().uri().required(),
  PAYMENT_SERVICE_URL: Joi.string().uri().required(),
  DELIVERY_SERVICE_URL: Joi.string().uri().required(),
  DEPOT_SERVICE_URL: Joi.string().uri().required(),
  DASHBOARD_SERVICE_URL: Joi.string().uri().required(),
  LOYALTY_SERVICE_URL: Joi.string().uri().required(),
  PROMO_SERVICE_URL: Joi.string().uri().required(),
  REFERRAL_SERVICE_URL: Joi.string().uri().required(),
  CRM_SERVICE_URL: Joi.string().uri().required(),
  RECOMMENDATION_SERVICE_URL: Joi.string().uri().required(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
});
