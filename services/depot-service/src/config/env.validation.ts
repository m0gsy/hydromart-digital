import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  DEPOT_SERVICE_PORT: Joi.number().port().default(3007),
  DEPOT_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // Low-stock alerting via crm-service (optional; blank disables the feature).
  CRM_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // Product catalog, read to validate and name PRODUK stock lines. Blank = validation
  // off: lines are accepted with the label the operator typed (fail-open).
  PRODUCT_SERVICE_URL: Joi.string().uri().allow('').default('http://localhost:3003'),
  DEPOT_ALERT_PHONE: Joi.string().allow('').default(''),
  // Closing a cashier's shift reads that depot's takings from payment-service. Blank means
  // shifts can be opened but never closed — deliberate: a shift close that guesses the
  // expected cash would accuse or absolve a real person on made-up numbers.
  PAYMENT_SERVICE_URL: Joi.string().uri().allow('').default(''),
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  // Per-gallon deposit (IDR) a courier-recorded return refunds (design 2e). Tune per
  // business; the courier never enters the amount — the server computes deposit × qty.
  GALLON_DEPOSIT_IDR: Joi.number().integer().min(0).default(20000),
  // Manager approval queue: value changes at/under this rupiah amount auto-pass without a
  // manager decision (mirrors payout's expense auto-approve). Tune per business.
  APPROVAL_AUTO_PASS_IDR: Joi.number().integer().min(0).default(100000),
  // Shared service-to-service secret authenticating the low-stock alert call to crm's
  // internal notification endpoint. Blank = alerting disabled (fail-open).
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  // Static-QRIS image storage (design 4b). Mirrors product/auth/delivery-service.
  STORAGE_LOCAL_DIR: Joi.string().default('./var/uploads'),
  // Public base URL the uploaded QRIS is reachable at. Local: returned URLs are
  // `${STORAGE_PUBLIC_BASE_URL}/uploads/<key>`. In production it MUST be a real public
  // origin — the CUSTOMER's payment screen loads this image, so a localhost value bakes
  // an unreachable QRIS into every order.
  STORAGE_PUBLIC_BASE_URL: Joi.string()
    .uri()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .uri()
        .pattern(/localhost|127\.0\.0\.1/, { invert: true })
        .required(),
      otherwise: Joi.string().uri().default('http://localhost:3007'),
    }),
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
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
});
