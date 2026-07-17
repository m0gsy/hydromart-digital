import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  CRM_SERVICE_PORT: Joi.number().port().default(3012),
  CRM_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // Optional: blank WHATSAPP_API_URL runs the broadcast adapter in console/dev mode.
  WHATSAPP_API_URL: Joi.string().allow('').default(''),
  WHATSAPP_API_TOKEN: Joi.string().allow('').default(''),
  // Optional: customer-service base URL for FR-087 attribute segmentation. Blank disables it.
  CUSTOMER_SERVICE_URL: Joi.string().allow('').default(''),
  // Shared secret authenticating system-to-system notification calls (POST /notifications/internal).
  // Blank = the internal route rejects everything (fail-closed).
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  // Web Push VAPID keypair (design 7b transport). Blank = push disabled (fail-open).
  // Generate with: node -e "console.log(require('web-push').generateVAPIDKeys())".
  VAPID_PUBLIC_KEY: Joi.string().allow('').default(''),
  VAPID_PRIVATE_KEY: Joi.string().allow('').default(''),
  VAPID_SUBJECT: Joi.string().default('mailto:ops@hydromart.id'),
});
