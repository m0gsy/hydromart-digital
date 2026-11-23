-- Rolls back 20261123100000_customer_source (auth-service, HD-8).
-- Lossy: the campaign codes recorded since are gone. The accounts stay.
-- Run it only after the images are back on the release before HD-8: Prisma in the HD-8 code
-- selects these columns on every customer read.
ALTER TABLE "customers" DROP COLUMN IF EXISTS "lastSource";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "firstSource";
