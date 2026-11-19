import { internalServiceKey, optionalSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  FACE_SERVICE_PORT: Joi.number().port().default(3019),
  // The only caller is hr-service, over the shared service-to-service secret. There is no
  // user here at all: no JWT, no public route but /health and /metrics.
  INTERNAL_SERVICE_KEY: internalServiceKey(),
  // PLAT-5: accepted alongside the key during a rotation.
  INTERNAL_SERVICE_KEY_PREVIOUS: optionalSecret(16),
  // Where the two pinned ONNX models sit (the image puts them there at build time).
  FACE_MODEL_DIR: Joi.string().default('/app/models'),
  // Inference runs one at a time; at most this many requests in flight, the running one
  // included. One more is a 503 at once, not a queue that grows until the container is killed
  // for memory.
  FACE_QUEUE_MAX: Joi.number().integer().min(1).max(64).default(8),
  // One inference past this is given up (503 ENGINE_TIMEOUT) and the next one starts: a single
  // hung run must not hold every later request behind it. hr-service's own deadline is shorter.
  FACE_INFER_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(10000),
});
