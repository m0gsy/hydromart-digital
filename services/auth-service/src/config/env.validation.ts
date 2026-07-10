import * as Joi from 'joi';

/**
 * Boot-time validation of environment variables. The application refuses to start
 * with missing or malformed configuration (fail fast — no silent misconfiguration).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  AUTH_SERVICE_PORT: Joi.number().port().default(3001),

  AUTH_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.number().integer().positive().default(900),
  JWT_REFRESH_TTL: Joi.number().integer().positive().default(2592000),

  OTP_TTL_SECONDS: Joi.number().integer().positive().max(600).default(300),
  OTP_LENGTH: Joi.number().integer().min(4).max(8).default(6),
  OTP_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().positive().default(60),
  OTP_DELIVERY_CHANNEL: Joi.string().valid('console', 'whatsapp', 'sms').default('console'),
  OTP_PEPPER: Joi.string().min(16).required(),

  WHATSAPP_API_BASE_URL: Joi.string().uri().allow('').optional(),
  WHATSAPP_API_TOKEN: Joi.string().allow('').optional(),
  WHATSAPP_OTP_TEMPLATE: Joi.string().allow('').default('hydromart_otp'),

  // Registration welcome via crm-service (internal service auth). Both blank = disabled.
  CRM_SERVICE_URL: Joi.string().uri().allow('').default(''),
  INTERNAL_SERVICE_KEY: Joi.string().allow('').default(''),

  SMS_API_BASE_URL: Joi.string().uri().allow('').optional(),
  SMS_API_TOKEN: Joi.string().allow('').optional(),
  SMS_SENDER_ID: Joi.string().allow('').default('HYDROMART'),

  GOOGLE_OAUTH_CLIENT_ID: Joi.string().allow('').optional(),

  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
})
  // If a delivery channel is selected, its provider credentials must be present.
  .when(Joi.object({ OTP_DELIVERY_CHANNEL: Joi.valid('whatsapp') }).unknown(), {
    then: Joi.object({
      WHATSAPP_API_BASE_URL: Joi.string().uri().required(),
      WHATSAPP_API_TOKEN: Joi.string().required(),
    }),
  })
  .when(Joi.object({ OTP_DELIVERY_CHANNEL: Joi.valid('sms') }).unknown(), {
    then: Joi.object({
      SMS_API_BASE_URL: Joi.string().uri().required(),
      SMS_API_TOKEN: Joi.string().required(),
    }),
  });
