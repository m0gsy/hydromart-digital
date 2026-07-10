import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  CRM_SERVICE_PORT: Joi.number().port().default(3012),
  CRM_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  // Optional: blank WHATSAPP_API_URL runs the broadcast adapter in console/dev mode.
  WHATSAPP_API_URL: Joi.string().allow('').default(''),
  WHATSAPP_API_TOKEN: Joi.string().allow('').default(''),
  // Optional: customer-service base URL for FR-087 attribute segmentation. Blank disables it.
  CUSTOMER_SERVICE_URL: Joi.string().allow('').default(''),
});
