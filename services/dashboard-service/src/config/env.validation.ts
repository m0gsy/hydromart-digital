import { requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  DASHBOARD_SERVICE_PORT: Joi.number().port().default(3008),
  JWT_ACCESS_SECRET: requiredSecret(32),
  // Shared service-to-service secret. This BFF fetches the global order/delivery/depot
  // reports as a trusted system principal (x-internal-key) rather than forwarding the
  // franchise owner's user JWT — required so those fan-out calls authenticate.
  INTERNAL_SERVICE_KEY: requiredSecret(16),
  ORDER_SERVICE_URL: Joi.string().uri().required(),
  DELIVERY_SERVICE_URL: Joi.string().uri().required(),
  DEPOT_SERVICE_URL: Joi.string().uri().required(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
});
