import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  REFERRAL_SERVICE_PORT: Joi.number().port().default(3011),
  REFERRAL_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  LOYALTY_SERVICE_URL: Joi.string().uri().required(),
  // customer-service base URL for depot->customerIds lookup (depot referral aggregate).
  // Blank = directory lookup disabled; the aggregate degrades to zeros (fail-open).
  CUSTOMER_SERVICE_URL: Joi.string().uri().allow('').default(''),
  REFERRAL_REFERRER_POINTS: Joi.number().integer().positive().default(500),
  REFERRAL_REFEREE_POINTS: Joi.number().integer().positive().default(250),
  // Shared service-to-service secret: guards /referrals/qualify (order-service triggers
  // it) AND authenticates referral's own reward call to loyalty. Blank = fail-closed.
  INTERNAL_SERVICE_KEY: optionalSecret(16),
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
