-- Rolls back 20261123100000_customer_source (auth-service, HD-8).
-- Lossy: the campaign codes recorded since are gone. The accounts stay.
ALTER TABLE "customers" DROP COLUMN IF EXISTS "lastSource";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "firstSource";
