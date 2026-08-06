import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // One business timezone for the whole platform (H-16); see @hydromart/platform.
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PROMO_SERVICE_PORT: Joi.number().port().default(3010),
  PROMO_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // Shared service-to-service secret guarding /vouchers/redeem (system-triggered by
  // order-service at checkout). Blank = fail-closed (internal calls rejected).
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  // Outbound targets for the voucher-grant notification (spec 7b/5h). Blank = grant
  // still succeeds; the "voucher baru" notification is skipped (fail-open).
  CRM_SERVICE_URL: Joi.string().uri().allow('').default(''),
  CUSTOMER_SERVICE_URL: Joi.string().uri().allow('').default(''),
  ORDER_SERVICE_URL: Joi.string().uri().required(),
  // Q-6: also from x-shared. The depot-scope resolver fails CLOSED on it, so an
  // unset value does not degrade tenant isolation — it refuses every scoped request.
  DEPOT_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
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
