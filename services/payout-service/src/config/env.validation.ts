import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PAYOUT_SERVICE_PORT: Joi.number().port().default(3016),
  PAYOUT_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  // Shared service-to-service key: guards POST /courier/ledger/internal (earning push).
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // HQ commission rate applied to gross sales settlements (0.05 = 5%). Reporting only.
  PAYOUT_COMMISSION_RATE: Joi.number().min(0).max(1).default(0.05),
  // Expense claims at or under this IDR amount auto-approve (0 = every claim needs a reviewer).
  EXPENSE_AUTO_APPROVE_MAX_IDR: Joi.number().integer().min(0).default(50000),
});
