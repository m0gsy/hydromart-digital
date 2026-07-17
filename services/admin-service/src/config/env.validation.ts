import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

import { SERVICE_REGISTRY } from './service-registry';

// Each peer service URL is OPTIONAL: an unset URL is omitted from the health roll-up
// (13b) rather than failing boot, so admin-service stays standalone-buildable/testable.
const peerUrlSchema = Object.fromEntries(
  SERVICE_REGISTRY.map((s) => [s.envKey, Joi.string().uri().optional()]),
);

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  ADMIN_SERVICE_PORT: Joi.number().port().default(3017),
  ADMIN_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // Shared service-to-service secret. Present so the platform JwtAuthGuard can accept
  // internal-key system calls; admin's own endpoints are JWT + role gated. Blank = off.
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  ...peerUrlSchema,
});
