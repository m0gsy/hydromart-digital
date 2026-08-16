import { optionalSecret, requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  CRM_SERVICE_PORT: Joi.number().port().default(3012),
  CRM_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  /*
   * Blank = WhatsApp is not configured. E-2: a blank URL used to make `send()` log the
   * message and report success, so a campaign whose whole audience was never contacted read
   * as fully delivered.
   *
   * The first fix here REFUSED to boot in production on a blank value, mirroring
   * auth-service's `console` OTP guard. That was rejected on purpose: `docker-compose.prod.yml`
   * defaults both of these to empty, so the guard would have stopped crm-service from
   * starting on the next deploy — trading a reporting lie for an outage. The lie is fixed
   * where it lived instead: the adapter reports NOT sent, and `processSending` refuses to
   * consume a queue it cannot deliver (see campaign.service.ts).
   */
  WHATSAPP_API_URL: Joi.string().allow('').default(''),
  WHATSAPP_API_TOKEN: Joi.string().allow('').default(''),
  // Optional: customer-service base URL for FR-087 attribute segmentation. Blank disables it.
  CUSTOMER_SERVICE_URL: Joi.string().allow('').default(''),
  // Optional: order-service base URL for the ACTIVITY half of a segment (lapsed/new/
  // frequent/ordered-at-depot). Blank makes an activity segment fail closed, never wider.
  ORDER_SERVICE_URL: Joi.string().allow('').default(''),
  // Shared secret authenticating system-to-system notification calls (POST /notifications/internal).
  // Blank = the internal route rejects everything (fail-closed).
  INTERNAL_SERVICE_KEY: optionalSecret(16),
  // Web Push VAPID keypair (design 7b transport). Blank = push disabled (fail-open).
  // Generate with: node -e "console.log(require('web-push').generateVAPIDKeys())".
  VAPID_PUBLIC_KEY: Joi.string().allow('').default(''),
  VAPID_PRIVATE_KEY: Joi.string().allow('').default(''),
  VAPID_SUBJECT: Joi.string().default('mailto:ops@hydromart.id'),
  // Firebase service account for FCM HTTP v1 (Android push, F4). Blank = Android push
  // disabled, same fail-open shape as VAPID — CI has no Firebase project. Declared here
  // because `check-env-contract.mjs` fails the build for any variable a compose file
  // passes that no schema knows about.
  FCM_PROJECT_ID: Joi.string().allow('').default(''),
  FCM_CLIENT_EMAIL: Joi.string().allow('').default(''),
  FCM_PRIVATE_KEY: Joi.string().allow('').default(''),
  // Q-6: also from x-shared. The depot-scope resolver fails CLOSED on it, so an
  // unset value does not degrade tenant isolation — it refuses every scoped request.
  DEPOT_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
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
