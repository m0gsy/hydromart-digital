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
  // `${STORAGE_PUBLIC_BASE_URL}/uploads/<key>`. In production it MUST be set to a
  // real public origin (a localhost value would bake unreachable URLs into
  // BR-mandatory PoD records); dev falls back to this service direct.
  STORAGE_PUBLIC_BASE_URL: Joi.string()
    .uri()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().uri().pattern(/localhost|127\.0\.0\.1/, { invert: true }).required(),
      otherwise: Joi.string().uri().default('http://localhost:3006'),
    }),
  // Which storage adapter backs uploads: 'local' (disk, dev) or 's3' (Cloudflare R2
  // / any S3-compatible endpoint, prod). The five STORAGE_S3_* keys below are
  // required only when this is 's3'.
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  // R2: endpoint = https://<account>.r2.cloudflarestorage.com, region = 'auto', and
  // STORAGE_PUBLIC_BASE_URL = the bucket's public URL (r2.dev or a bound domain).
  STORAGE_S3_ENDPOINT: Joi.string()
    .uri()
    .when('STORAGE_DRIVER', { is: 's3', then: Joi.required() }),
  STORAGE_S3_REGION: Joi.string().default('auto'),
  STORAGE_S3_BUCKET: Joi.string().when('STORAGE_DRIVER', { is: 's3', then: Joi.required() }),
  STORAGE_S3_ACCESS_KEY_ID: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
  }),
  STORAGE_S3_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
  }),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
});
