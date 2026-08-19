import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  ORDER_SERVICE_PORT: Joi.number().port().default(3004),
  ORDER_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  PRODUCT_SERVICE_URL: Joi.string().uri().required(),
  DEPOT_SERVICE_URL: Joi.string().uri().required(),
  LOYALTY_SERVICE_URL: Joi.string().uri().required(),
  CUSTOMER_SERVICE_URL: Joi.string().uri().required(),
  PROMO_SERVICE_URL: Joi.string().uri().required(),
  REFERRAL_SERVICE_URL: Joi.string().uri().required(),
  CRM_SERVICE_URL: Joi.string().uri().required(),
  // recommendation-service base URL; the completed-order ingest push is fail-open, so
  // a blank value (unset) simply disables it rather than blocking startup.
  RECOMMENDATION_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // forecast-service base URL; the completed-order ingest push is fail-open, so
  // a blank value (unset) simply disables it rather than blocking startup.
  FORECAST_SERVICE_URL: Joi.string().allow('').default(''),
  // Blank = franchise revenue push disabled (order completion still succeeds).
  PAYOUT_SERVICE_URL: Joi.string().allow('').default(''),
  // Shared service-to-service secret. Notifications to crm and the payment→order
  // confirm callback authenticate with this (not a user JWT). Blank = fail-closed.
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  ORDER_DELIVERY_FEE: Joi.number().min(0).default(1000),
  // Age (minutes) after which an unconfirmed CREATED order is treated as abandoned
  // and can be auto-cancelled (releasing its stock hold). Company policy default.
  ORDER_ABANDON_MINUTES: Joi.number().integer().positive().default(60),
  // Age (hours) after which an order stuck at CONFIRMED/PREPARING is treated as stalled
  // and auto-cancelled, releasing its stock hold. Long by design — the depot has already
  // accepted the order, and payment is collected at the depot, so being unpaid is normal.
  ORDER_STALLED_HOURS: Joi.number().integer().positive().default(24),
  // Percent off the subtotal of every subscription delivery (spec 7b "hemat 5%").
  // Boot-time fallback only; a depot may override it through settings.
  ORDER_SUBSCRIPTION_DISCOUNT_PCT: Joi.number().min(0).max(50).default(5),
  // Express ("antar sekarang") delivery. Boot-time fallbacks only; every one of these is
  // overridable per depot through settings, which is where they belong — the surcharge is
  // charged, not decorative.
  // A1 kill switch: 0 sends the cart back to catalog base prices. Overridable per depot
  // through settings, like the express toggle above.
  ORDER_CART_DEPOT_PRICING: Joi.number().integer().min(0).max(1).default(1),
  ORDER_EXPRESS_ENABLED: Joi.number().integer().min(0).max(1).default(1),
  ORDER_EXPRESS_FEE: Joi.number().min(0).default(5000),
  ORDER_EXPRESS_ETA_MIN_MINUTES: Joi.number().integer().positive().default(30),
  ORDER_EXPRESS_ETA_MAX_MINUTES: Joi.number().integer().positive().default(60),
  // Scheduled delivery windows offered at checkout: comma-separated `HH.MM-HH.MM`.
  ORDER_DELIVERY_SLOTS: Joi.string()
    .pattern(/^\d{2}\.\d{2}-\d{2}\.\d{2}(,\d{2}\.\d{2}-\d{2}\.\d{2})*$/)
    .default('09.00-11.00,11.00-13.00,13.00-15.00,15.00-17.00,17.00-19.00'),
  // Nominal galon fill used to express a water-meter variance as "setara galon".
  ORDER_METER_REFERENCE_VOLUME_ML: Joi.number().integer().positive().default(19000),
  // Litres of meter-vs-sales variance tolerated before an ops alert fires.
  ORDER_METER_VARIANCE_TOLERANCE_LITERS: Joi.number().integer().min(0).default(200),
  // Ops WhatsApp number for staff-facing alerts (meter variance). Blank = alerting off,
  // same fail-open convention depot-service uses for its low-stock alert.
  ORDER_ALERT_PHONE: Joi.string().allow('').default(''),
  // Which calendar day a counter sale belongs to, for the same-day void window. Same name
  // and default as depot-service so both agree on when the till's day ends.
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  // Where a voided counter sale's refund goes. Blank = voiding is unavailable, which beats
  // marking a sale reversed while payment-service still holds the money.
  PAYMENT_SERVICE_URL: Joi.string().uri().allow('').default(''),
  DELIVERY_SERVICE_URL: Joi.string().uri().allow('').default(''),
  HR_SERVICE_URL: Joi.string().uri().allow('').default(''),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
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
