import { requiredSecret } from '@hydromart/platform';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  HR_SERVICE_PORT: Joi.number().port().default(3018),
  HR_DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: requiredSecret(32),
  CORS_ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  PRICING_TZ: Joi.string().default('Asia/Jakarta'),
  // Attendance / payroll boot-time defaults (business-tunable per depot via /settings).
  HR_WORK_START_TIME: Joi.string()
    .pattern(/^\d{2}:\d{2}$/)
    .default('08:00'),
  HR_LATE_TOLERANCE_MINUTES: Joi.number().integer().min(0).default(15),
  // Q-13 statutory payroll defaults. Percentages ×100 so the settings store stays
  // integer-only. These must mirror config/setting-defs.ts envDefault values.
  HR_BPJS_HEALTH_EMPLOYEE_PCT_X100: Joi.number().integer().min(0).default(100),
  HR_BPJS_HEALTH_CEILING_IDR: Joi.number().integer().min(0).default(12_000_000),
  HR_BPJS_JHT_EMPLOYEE_PCT_X100: Joi.number().integer().min(0).default(200),
  HR_BPJS_JP_EMPLOYEE_PCT_X100: Joi.number().integer().min(0).default(100),
  HR_BPJS_JP_CEILING_IDR: Joi.number().integer().min(0).default(10_547_400),
  HR_OCCUPATIONAL_COST_PCT_X100: Joi.number().integer().min(0).default(500),
  HR_OCCUPATIONAL_COST_CAP_IDR: Joi.number().integer().min(0).default(500_000),
  HR_NO_NPWP_SURCHARGE_PCT: Joi.number().integer().min(0).max(100).default(20),
  HR_LATE_DEDUCTION_IDR: Joi.number().integer().min(0).default(10000),
  HR_DAILY_RATE_TRAINING_IDR: Joi.number().integer().min(0).default(30000),
  HR_ABSENCE_DEDUCTION_IDR: Joi.number().integer().min(0).default(0),
  HR_STANDARD_WORKING_MINUTES: Joi.number().integer().min(0).default(480),
  // Tenure raise ladder for depot heads (Rule-E): "years:pct" CSV, e.g. "1:5,2:10,3:15".
  // Empty = no automatic raise.
  HR_TENURE_RAISE_LADDER: Joi.string().allow('').default(''),
  // Working days of quota-consuming leave (ANNUAL/PERMISSION) per calendar year.
  HR_ANNUAL_LEAVE_QUOTA_DAYS: Joi.number().min(0).max(60).default(12),
  // Face recognition. neo = BiznetGio NEO cloud gallery (prod); onnx = in-process ArcFace;
  // stub = dev/test deterministic.
  FACE_VERIFIER_DRIVER: Joi.string().valid('neo', 'onnx', 'http', 'stub').default('onnx'),
  HR_FACE_MATCH_THRESHOLD: Joi.number().min(0).max(1).default(0.62),
  HR_FACE_DUPLICATE_THRESHOLD: Joi.number().min(0).max(1).default(0.75),
  HR_FACE_MODEL_PATH: Joi.string().default('./models/arcface.onnx'),
  FACE_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // B-19: key the enrolled face templates are encrypted with at rest (AES-256-GCM).
  // `openssl rand -hex 32`. Production must supply it — biometrics cannot be reissued
  // after a leak, so they must never sit in the table (or a backup dump) in the clear.
  // Rotating it makes existing enrolments undecryptable: employees must re-enroll.
  HR_FACE_ENCRYPTION_KEY: Joi.string()
    .allow('')
    .default('')
    // `.invalid('')` because a `when` branch is concat'ed onto the base key, and the base
    // `.allow('')` would otherwise keep an empty key legal in production.
    .when('NODE_ENV', { is: 'production', then: Joi.string().min(32).invalid('').required() }),
  // order-service base URL + shared internal key for the SALES_TOTAL bonus aggregate.
  // Both empty → SALES rules stay dormant (salesTotal resolves null, never fabricated).
  ORDER_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // auth-service base URL for provisioning staff logins during a bulk employee import.
  // Empty → the import rejects every row (503) rather than creating staff who can't sign in.
  AUTH_SERVICE_URL: Joi.string().uri().allow('').default(''),
  // crm-service base URL for HR notifications (leave decisions, announcements). Empty →
  // notifications are skipped with a warning; an HR approval never fails because crm is down.
  CRM_SERVICE_URL: Joi.string().uri().allow('').default(''),
  INTERNAL_SERVICE_KEY: Joi.string().allow('').default(''),
  // NEO Face Recognition (FACE_VERIFIER_DRIVER=neo). Token is box-`.env` only, never committed.
  NEO_FR_ENDPOINT: Joi.string().uri().default('https://fr.neoapi.id'),
  NEO_FR_TOKEN: Joi.string().allow('').default(''),
  NEO_FR_GALLERY_ID: Joi.string().default('hydromart-hr'),
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
