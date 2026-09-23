-- Rollback for 20260923130000_biometric_consent. Drops the recorded consents with the columns.
ALTER TABLE "employees"
  DROP COLUMN IF EXISTS "faceConsentAt",
  DROP COLUMN IF EXISTS "faceConsentBy",
  DROP COLUMN IF EXISTS "faceConsentSource";
