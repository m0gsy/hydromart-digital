import { internalServiceKey, optionalSecret, requiredSecret } from '@hydromart/platform';
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
  // Optional: customer-service base URL for FR-087 attribute segmentation. Blank disables it.
  // CRM-08: required in production. Blank passed validation there and then every campaign
  // audience resolved to FAILED. (Dev may stay blank; compose sets it.)
  CUSTOMER_SERVICE_URL: Joi.string()
    .uri()
    .allow('')
    .default('')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().required().invalid('') }),
  ADMIN_SERVICE_URL: Joi.string().allow('').default(''),
  // AI-9: dashboard-service, for the morning summary's approval queues. Blank = the summary fails 503.
  DASHBOARD_SERVICE_URL: Joi.string().allow('').default(''),
  // AI-26: the AI web origin (https://ai...), for the link in the weekly Sales report email. Blank = that notice fails 503.
  AI_WEB_URL: Joi.string().allow('').default(''),
  // HD-18: loyalty-service, for the point lots about to expire. Blank = that reminder fails 503.
  LOYALTY_SERVICE_URL: Joi.string().allow('').default(''),
  // Optional: order-service base URL for the ACTIVITY half of a segment (lapsed/new/
  // frequent/ordered-at-depot). Blank makes an activity segment fail closed, never wider.
  ORDER_SERVICE_URL: Joi.string().allow('').default(''),
  // Shared secret authenticating system-to-system notification calls (POST /notifications/internal).
  // Blank = the internal route rejects everything (fail-closed).
  INTERNAL_SERVICE_KEY: internalServiceKey(),
  // PLAT-5: accepted alongside INTERNAL_SERVICE_KEY during a rotation, so moving to a new
  // key is a two-step roll instead of a flag day across all seventeen services. Blank
  // (the default) means no rotation in progress.
  INTERNAL_SERVICE_KEY_PREVIOUS: optionalSecret(16),
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
  // WhatsApp number 1 (HD-12/HD-13). ALL blank = off: nothing is sent, the webhook answers 404. Values live on the
  // box or in the GitHub secret, never in the repo; the validator allows blank so a half-filled set cannot stop crm booting.
  WA_ENABLED: Joi.string().allow('').default(''),
  WA_ACCESS_TOKEN: Joi.string().allow('').default(''),
  WA_APP_SECRET: Joi.string().allow('').default(''),
  WA_VERIFY_TOKEN: Joi.string().allow('').default(''),
  WA_PHONE_NUMBER_ID_1: Joi.string().allow('').default(''),
  WA_WABA_ID_1: Joi.string().allow('').default(''),
  WA_GRAPH_VERSION: Joi.string().allow('').default(''),
  WA_NUMBER_1_E164: Joi.string().allow('').default(''),
  WA_LEGAL_ENTITY_NAME: Joi.string().allow('').default(''),
  WA_PEER_MAX_AGE_SECONDS: Joi.string().allow('').default(''),
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
