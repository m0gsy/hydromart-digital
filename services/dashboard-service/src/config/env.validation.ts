import { requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // One business timezone for the whole platform (H-16); see @hydromart/platform.
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
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
  // Optional: when set, the roll-up applies the org SLA on-time threshold from
  // admin-service. Unset → delivery-service falls back to its own default.
  ADMIN_SERVICE_URL: Joi.string().uri().optional(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  HR_SERVICE_URL: Joi.string().uri().allow('').default(''),
  CUSTOMER_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // Q-6: shipped to every service by docker-compose's x-shared, and until now
  // validated by none of them. The capability poller reads it; unset, it fails open
  // and every service silently enforces the compiled RBAC defaults forever — which
  // looks exactly like "the matrix edit did nothing".
  AUTH_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
});
