import { internalServiceKey, optionalSecret, requiredSecret } from '@hydromart/platform';
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
  // Addresses the gallon-return reminder to a customer (name + phone by id). Blank = the
  // reminder sweep skips everyone as "no number" rather than failing.
  CUSTOMER_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // CA-2-58: head office's complaint queue. Blank = a depot complaint is not mirrored.
  ADMIN_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // Product catalog, read to validate and name PRODUK stock lines. Blank = validation
  // off: lines are accepted with the label the operator typed (fail-open).
  // D1-07: in production the default must not be localhost (it pointed the catalog at nothing,
  // silently). There it defaults to blank = validation off, and an explicit localhost is refused.
  // Not made REQUIRED: unlike the others it is genuinely optional (fail-open), and the
  // integration stack (docker-compose.test.yml, NODE_ENV=production) does not set it.
  PRODUCT_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('http://localhost:3003')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string()
        .uri()
        .allow('')
        .pattern(/localhost|127\.0\.0\.1/, { invert: true })
        .default(''),
    }),
  DEPOT_ALERT_PHONE: Joi.string().allow('').default(''),
  // HD-22: the AI web partner form /waralaba hands over to. Blank = the in-app form stays. Never fails boot: a bad value reads as off (see the getter).
  FRANCHISE_LEAD_FORM_URL: Joi.string().allow('').optional().default(''),
  // Closing a cashier's shift reads that depot's takings from payment-service. Blank means
  // shifts can be opened but never closed — deliberate: a shift close that guesses the
  // expected cash would accuse or absolve a real person on made-up numbers.
  // D1-08: required in production for the same reason (compose sets it).
  PAYMENT_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
  // Courier COD totals for the daily close. Blank = a day cannot be closed (fail closed).
  DELIVERY_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
  // hr-service, asked which SOP version a visit checklist item points at. Optional (fail-soft):
  // blank means a checklist shows without its SOP link, never that a visit cannot start.
  HR_SERVICE_URL: Joi.string().uri().allow('').default(''),
  ORDER_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  // Per-gallon deposit (IDR) a courier-recorded return refunds (design 2e). Tune per
  // business; the courier never enters the amount — the server computes deposit × qty.
  GALLON_DEPOSIT_IDR: Joi.number().integer().min(0).default(20000),
  // How long a customer may hold a depot's gallons before they count as overdue. A gallon is
  // a deposit-backed asset the depot has to buy again if it never comes back.
  GALLON_MAX_HOLD_DAYS: Joi.number().integer().min(1).max(365).default(14),
  // Once a customer is overdue, how many days pass before the depot asks again. The reminder
  // sweep runs daily; without this it would send the same message every morning.
  GALLON_REMINDER_EVERY_DAYS: Joi.number().integer().min(1).max(90).default(7),
  // Manager approval queue: value changes at/under this rupiah amount auto-pass without a
  // manager decision (mirrors payout's expense auto-approve). Tune per business.
  APPROVAL_AUTO_PASS_IDR: Joi.number().integer().min(0).default(100000),
  // Shared service-to-service secret authenticating the low-stock alert call to crm's
  // internal notification endpoint. Blank = alerting disabled (fail-open).
  INTERNAL_SERVICE_KEY: internalServiceKey(),
  // PLAT-5: accepted alongside INTERNAL_SERVICE_KEY during a rotation, so moving to a new
  // key is a two-step roll instead of a flag day across all seventeen services. Blank
  // (the default) means no rotation in progress.
  INTERNAL_SERVICE_KEY_PREVIOUS: optionalSecret(16),
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
  // HD-15B: supervisor-visit finding photos, in a PRIVATE bucket of their own. Optional: unset, the
  // service boots and the photo upload route answers 503 until the owner sets the three.
  VISIT_STORAGE_S3_BUCKET: Joi.string().allow('').default(''),
  VISIT_STORAGE_S3_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  VISIT_STORAGE_S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  // Metres from the depot's map point a supervisor may check in from; 0 = not fenced.
  VISIT_CHECKIN_RADIUS_M: Joi.number().integer().min(0).max(5000).default(200),
  // HD-15B PR-6: tell Kepala / supervisors / HQ about visit findings and overdue follow-ups.
  // false until the Ops build with the visit screens is on phones.
  VISIT_NOTIFY_ENABLED: Joi.boolean().default(false),
  STORAGE_S3_BUCKET: Joi.string().when('STORAGE_DRIVER', { is: 's3', then: Joi.required() }),
  STORAGE_S3_ACCESS_KEY_ID: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
  }),
  STORAGE_S3_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.required(),
  }),
  // Q-6: shipped to every service by docker-compose's x-shared, and until now
  // validated by none of them. The capability poller reads it; unset, it fails open
  // and every service silently enforces the compiled RBAC defaults forever — which
  // looks exactly like "the matrix edit did nothing". H-29's price-override audit trail
  // is written over this same URL, so in production it is now required, not optional.
  AUTH_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
});
