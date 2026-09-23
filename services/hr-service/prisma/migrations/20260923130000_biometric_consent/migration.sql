-- HR-3: face enrolment had no consent anywhere — not captured, not recorded, not enforced.
-- Biometric data is "data pribadi spesifik" under UU 27/2022 and needs explicit consent that
-- can be shown afterwards and withdrawn.
--
-- Nullable with no backfill and no default, deliberately: never asked is not the same as
-- refused, and stamping NOW() on every existing enrolment would manufacture a consent nobody
-- gave. Existing staff keep working (verification reads the templates already enrolled) and
-- are asked the next time they enrol.
--
-- No index: these columns are read off an employee row already fetched by id.
ALTER TABLE "employees"
  ADD COLUMN "faceConsentAt" TIMESTAMP(3),
  ADD COLUMN "faceConsentBy" UUID,
  ADD COLUMN "faceConsentSource" TEXT;
