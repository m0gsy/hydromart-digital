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
  //
  // H-25: these two also carry SEC-1. getOrderTotal() returns null — "validation
  // skipped" — when either is blank, so an unset value does not degrade the
  // price-tamper guard, it removes it, silently, on the money path. Production
  // must have both; dev/test may still run with the callback disabled.
  // `.invalid('')` is what actually forbids the blank: a `when` branch is CONCAT'ed
  // onto the base key, and the base's `.allow('')` would otherwise survive it.
  ORDER_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
  INTERNAL_SERVICE_KEY: optionalSecret(16).when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required().invalid(''),
  }),
  // Q-11: refunds strictly above this (IDR) need HQ approval. Unset = the documented
  // default in domain/payment.ts, which is the only place that number lives — a
  // `.default()` here would be a second copy of it, free to drift.
  REFUND_HQ_THRESHOLD: Joi.number().integer().positive().optional(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  // K2.2: hours a non-cash PENDING payment may sit before the scheduler fails it.
  // 0 disables the sweep and restores the old "never expires" behaviour.
  PAYMENT_PENDING_TTL_HOURS: Joi.number().integer().min(0).default(24),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
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
  // looks exactly like "the matrix edit did nothing". H-29's refund audit trail is
  // written over this same URL, so in production it is now required, not optional.
  AUTH_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
});
