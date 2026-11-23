-- HD-8 (Plan Eksekusi): where a customer who signed up themselves came from.
-- firstSource / lastSource: the campaign codes of the first and the latest coded link their
-- browser arrived by (the attribution rule: the first source stays, the latest is kept beside
-- it). Written on the account's first row by self-registration only.
-- Nullable, no default, no backfill: staff, counter sales, signups that followed no coded link
-- and every older account have no source, and the code before this release never reads these
-- columns.
-- RERUNNABLE: ADD COLUMN IF NOT EXISTS.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstSource" VARCHAR(64);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "lastSource" VARCHAR(64);
