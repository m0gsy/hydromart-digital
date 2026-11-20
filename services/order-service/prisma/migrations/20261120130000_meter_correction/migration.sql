-- Owner decision 2026-11-20: a previous day's meter reading may be corrected, with a reason,
-- and the day then shows who corrected it, when and why. Nullable: every existing row is an
-- uncorrected reading, and today's saves never stamp these.
ALTER TABLE "meter_readings" ADD COLUMN "correctedAt" TIMESTAMP(3);
ALTER TABLE "meter_readings" ADD COLUMN "correctedBy" UUID;
ALTER TABLE "meter_readings" ADD COLUMN "correctionReason" TEXT;
