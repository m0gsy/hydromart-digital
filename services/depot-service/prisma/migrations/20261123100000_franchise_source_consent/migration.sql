-- HD-8 (Plan Eksekusi): where a calon mitra came from, and which privacy text they agreed to.
-- firstSource / lastSource: the campaign codes of the first and the latest coded link the
-- applicant's browser arrived by (the attribution rule: the first source stays, the latest is
-- kept beside it). Null when no coded link was followed, and for every older application.
-- privacyConsentVersion: the Kebijakan Privasi version in force when the box was ticked; the
-- moment is "submittedAt". Null for older applications: since CA-3-53 the box was required,
-- but which text it agreed to was not kept.
-- Nullable, no default, no backfill: an older row has no source and no recorded version, and
-- the code before this release never reads these columns.
-- RERUNNABLE: ADD COLUMN IF NOT EXISTS.
ALTER TABLE "franchise_applications" ADD COLUMN IF NOT EXISTS "firstSource" VARCHAR(64);
ALTER TABLE "franchise_applications" ADD COLUMN IF NOT EXISTS "lastSource" VARCHAR(64);
ALTER TABLE "franchise_applications" ADD COLUMN IF NOT EXISTS "privacyConsentVersion" TEXT;
