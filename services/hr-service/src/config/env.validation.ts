import { requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  HR_SERVICE_PORT: Joi.number().port().default(3018),
  HR_DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  // Attendance / payroll boot-time defaults (business-tunable per depot via /settings).
  HR_WORK_START_TIME: Joi.string().pattern(/^\d{2}:\d{2}$/).default('08:00'),
  HR_LATE_TOLERANCE_MINUTES: Joi.number().integer().min(0).default(15),
  HR_LATE_DEDUCTION_IDR: Joi.number().integer().min(0).default(10000),
  HR_DAILY_RATE_TRAINING_IDR: Joi.number().integer().min(0).default(30000),
  HR_ABSENCE_DEDUCTION_IDR: Joi.number().integer().min(0).default(0),
  HR_STANDARD_WORKING_MINUTES: Joi.number().integer().min(0).default(480),
  // Face recognition (in-process ArcFace via onnxruntime-node; no cloud, no GPU required).
  FACE_VERIFIER_DRIVER: Joi.string().valid('onnx', 'http', 'stub').default('onnx'),
  HR_FACE_MATCH_THRESHOLD: Joi.number().min(0).max(1).default(0.62),
  HR_FACE_DUPLICATE_THRESHOLD: Joi.number().min(0).max(1).default(0.75),
  HR_FACE_MODEL_PATH: Joi.string().default('./models/arcface.onnx'),
  FACE_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // Photo storage (shared StoragePort). Local disk in dev; S3-compatible in prod.
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  STORAGE_LOCAL_DIR: Joi.string().default('./var/uploads'),
  STORAGE_PUBLIC_BASE_URL: Joi.string().allow('').default(''),
  STORAGE_S3_ENDPOINT: Joi.string().allow('').default(''),
  STORAGE_S3_REGION: Joi.string().allow('').default('us-east-1'),
  STORAGE_S3_BUCKET: Joi.string().allow('').default(''),
  STORAGE_S3_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  STORAGE_S3_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
});
