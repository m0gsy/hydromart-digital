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
  // Read for the depot's coordinates when a courier checks in (GET /depots/:id is public).
  DEPOT_SERVICE_URL: Joi.string().uri().required(),
  // Read for the PAID-cash total when a courier settles a shift's COD (fail-closed).
  PAYMENT_SERVICE_URL: Joi.string().uri().required(),
  // crm-service base URL for pushing HIGH field incidents to the ops feed (design 4b).
  // Blank = incident ops alerting disabled (fail-open).
  CRM_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // payout-service base URL for the courier earning push (delivery→payout). Blank = disabled.
  PAYOUT_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // WhatsApp number that receives HIGH incident alerts (the ops number). Blank = disabled.
  OPS_ALERT_PHONE: Joi.string().allow('').default(''),
  MAX_ACTIVE_DELIVERIES_PER_DRIVER: Joi.number().integer().positive().default(1),
  // How close to the depot a courier must stand to check in (design 3a).
  SHIFT_CHECKIN_RADIUS_M: Joi.number().integer().positive().default(200),
  // Shift window length, frozen onto the shift at check-in. ponytail: derived from
  // check-in because there is no roster yet — a roster (design Operator 6d) would
  // schedule the window ahead of time instead.
  SHIFT_LENGTH_HOURS: Joi.number().positive().default(8),
  // Paid break allowance per shift (design 3b countdown). Exceeding it is recorded
  // as an overage, not blocked.
  SHIFT_BREAK_QUOTA_MINUTES: Joi.number().integer().positive().default(30),
  // No-show gate (design 5a): a courier must make this many contact attempts and
  // wait this many seconds (from the first attempt) before failing a delivery as
  // a no-show. Both together stop a premature no-show.
  NO_SHOW_MIN_CONTACT_ATTEMPTS: Joi.number().integer().positive().default(2),
  NO_SHOW_MIN_WAIT_SECONDS: Joi.number().integer().positive().default(300),
  DELIVERY_SLA_MINUTES: Joi.number().integer().positive().default(120),
  // Weekly delivered-orders target shown on the courier performance card (design 4c).
  // A display/goal only — nothing is blocked when unmet. Default fills it, so no
  // compose change is needed.
  COURIER_WEEKLY_TARGET: Joi.number().integer().positive().default(45),
  // Flat per-delivery commission paid to couriers from depot cash (design 11c). A pay/
  // display figure only; the default fills it, so no compose change is needed.
  COURIER_RATE_PER_DELIVERY_IDR: Joi.number().integer().positive().default(12000),
  // UU PDP retention window for proof-of-delivery data (photo/signature/name/GPS).
  // The scheduler purges rows older than this daily; the storage bucket must carry
  // a matching lifecycle rule to expire the image files.
  POD_RETENTION_DAYS: Joi.number().integer().positive().default(365),
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
  // BiznetGio NEO (primary): endpoint = https://nos.jkt-1.neo.id, bucket =
  // hydromart-pod, region = jkt-1, STORAGE_PUBLIC_BASE_URL =
  // https://nos.jkt-1.neo.id/hydromart-pod (bucket must be public-read).
  // Cloudflare R2 alt: endpoint = https://<account>.r2.cloudflarestorage.com,
  // region = auto, STORAGE_PUBLIC_BASE_URL = the r2.dev / bound-domain URL.
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
