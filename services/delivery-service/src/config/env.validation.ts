import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  DELIVERY_SERVICE_PORT: Joi.number().port().default(3006),
  DELIVERY_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  // Shared service-to-service secret. The platform JwtAuthGuard treats a caller
  // presenting this (x-internal-key) as a trusted system principal — the dashboard BFF
  // uses it to read the global SLA report. Blank = internal-key auth stays fail-closed.
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  ORDER_SERVICE_URL: Joi.string().uri().required(),
  MAX_ACTIVE_DELIVERIES_PER_DRIVER: Joi.number().integer().positive().default(1),
  DELIVERY_SLA_MINUTES: Joi.number().integer().positive().default(120),
  // Root dir the local-disk storage adapter writes uploads under (dev). Ignored
  // once a cloud storage adapter is wired.
  STORAGE_LOCAL_DIR: Joi.string().default('./var/uploads'),
  // Public base URL uploaded files are reachable at; returned URLs are
  // `${STORAGE_PUBLIC_BASE_URL}/uploads/<key>`. Dev default = this service direct.
  // Prod (behind the gateway) or R2 sets this to the real public origin.
  STORAGE_PUBLIC_BASE_URL: Joi.string().uri().default('http://localhost:3006'),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
});
