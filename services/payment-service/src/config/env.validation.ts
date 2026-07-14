import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PAYMENT_SERVICE_PORT: Joi.number().port().default(3005),
  PAYMENT_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  PAYMENT_GATEWAY_BASE_URL: Joi.string().uri().allow('').default(''),
  PAYMENT_GATEWAY_API_KEY: Joi.string().allow('').default(''),
  PAYMENT_WEBHOOK_SECRET: requiredSecret(16),
  // order-service base URL + shared secret for the payment→order confirm callback.
  // Both blank = the callback is disabled (order stays CREATED until staff confirm).
  ORDER_SERVICE_URL: Joi.string().uri().allow('').default(''),
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
});
