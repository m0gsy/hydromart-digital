import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // One business timezone for the whole platform (H-16); see @hydromart/platform.
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PAYOUT_SERVICE_PORT: Joi.number().port().default(3016),
  PAYOUT_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  // Shared service-to-service key: guards POST /courier/ledger/internal (earning push).
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // HQ commission rate applied to gross sales settlements (0.05 = 5%). Reporting only.
  // Expense claims at or under this IDR amount auto-approve (0 = every claim needs a reviewer).
  EXPENSE_AUTO_APPROVE_MAX_IDR: Joi.number().integer().min(0).default(50000),
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
