-- Rolls back 20261120130000_meter_correction. The correction note is lost; the readings stay.
ALTER TABLE "meter_readings" DROP COLUMN IF EXISTS "correctionReason";
ALTER TABLE "meter_readings" DROP COLUMN IF EXISTS "correctedBy";
ALTER TABLE "meter_readings" DROP COLUMN IF EXISTS "correctedAt";
