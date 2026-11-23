-- Rolls back 20261123100000_franchise_source_consent (depot-service, HD-8).
-- Lossy: the sources and consent versions recorded since are gone. The applications stay.
-- Run it only after the images are back on the release before HD-8: Prisma in the HD-8 code
-- selects these columns on every application read.
ALTER TABLE "franchise_applications" DROP COLUMN IF EXISTS "privacyConsentVersion";
ALTER TABLE "franchise_applications" DROP COLUMN IF EXISTS "lastSource";
ALTER TABLE "franchise_applications" DROP COLUMN IF EXISTS "firstSource";
