import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  GATEWAY_PORT: Joi.number().port().default(8080),
  AUTH_SERVICE_URL: Joi.string().uri().required(),
  CUSTOMER_SERVICE_URL: Joi.string().uri().required(),
  PRODUCT_SERVICE_URL: Joi.string().uri().required(),
  ORDER_SERVICE_URL: Joi.string().uri().required(),
  PAYMENT_SERVICE_URL: Joi.string().uri().required(),
  DELIVERY_SERVICE_URL: Joi.string().uri().required(),
  DEPOT_SERVICE_URL: Joi.string().uri().required(),
  DASHBOARD_SERVICE_URL: Joi.string().uri().required(),
  LOYALTY_SERVICE_URL: Joi.string().uri().required(),
  PROMO_SERVICE_URL: Joi.string().uri().required(),
  REFERRAL_SERVICE_URL: Joi.string().uri().required(),
  CRM_SERVICE_URL: Joi.string().uri().required(),
  RECOMMENDATION_SERVICE_URL: Joi.string().uri().required(),
  FORECAST_SERVICE_URL: Joi.string().uri().required(),
  PAYOUT_SERVICE_URL: Joi.string().uri().required(),
  ADMIN_SERVICE_URL: Joi.string().uri().required(),
  HR_SERVICE_URL: Joi.string().uri().required(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  // Per client per minute (see the `trust proxy` note in gateway.setup.ts — before that
  // fix this was per DEPLOYMENT, which is why 100 ever looked sufficient).
  //
  // 100 is far too low for one real user: a single HQ dashboard page currently fires ~201
  // requests on open (audit F-1), so the old ceiling could not survive one page load even
  // with correct per-client keying. 600 leaves room for roughly three heavy page loads a
  // minute per person while still stopping a scripted flood.
  //
  // This number is sized around a frontend defect, not around what the API should need.
  // When F-1 lands and the fan-out drops, bring it back down — it is a ceiling, not a target.
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(600),
  // The OTP tier. Separate from RATE_LIMIT_MAX because it is sized by a different
  // question: not "what should the API serve" but "how many paid SMS is one IP allowed to
  // cause". A human registering needs three calls; twenty a minute is seven honest
  // attempts. RATE_LIMIT_MAX cannot substitute for it — at 600 an attacker walks 600
  // distinct phone numbers a minute and every one of them is invoiced.
  RATE_LIMIT_OTP_MAX: Joi.number().integer().positive().default(20),
  // The BURST ceiling, over a ten-second window, alongside the per-minute one above.
  //
  // A fixed window resets on a wall-clock boundary: spend the whole minute quota in its last
  // second and the next minute's in its first, and TWICE the limit has gone out in two
  // seconds — inside the rules, and exactly the shape that hurts, because the ceiling is a
  // per-minute promise while the damage is per-second.
  //
  // 100/10s is the same 600/minute average as the default sustained limit, so it cannot
  // refuse a legitimate minute; it only flattens the boundary spike from 2x to about 1.2x.
  // A token bucket is the proper fix and is what to move to with the shared store (the
  // trigger is written down in DEPLOY.md).
  RATE_LIMIT_BURST_MAX: Joi.number().integer().positive().default(100),
  // Not knobs this service acts on — they describe the shape of the edge in front of it,
  // and together they decide whether trusting one X-Forwarded-For hop is safe at all
  // (trustProxyHops in gateway.setup.ts). Compose owns both; the gateway only reads them,
  // and until now could not read them at all. Blank = compose's own defaults: loopback
  // bind, no proxy.
  PUBLIC_BIND: Joi.string().allow('').default(''),
  WEB_DOMAIN: Joi.string().allow('').default(''),
  // F5: the lowest Android versionCode allowed to keep running. 0 = the gate is off,
  // which is the correct default and the state it will normally be in — it exists so
  // that a build with a broken checkout or a leaked token can be shut off in minutes
  // instead of waiting for everybody to update on their own.
  MOBILE_MIN_VERSION_CODE: Joi.number().integer().min(0).default(0),
  // Shown on the blocking screen. Blank falls back to the copy in the app, which is the
  // only string available if the gateway is unreachable anyway.
  MOBILE_UPDATE_MESSAGE: Joi.string().allow('').default(''),
});
