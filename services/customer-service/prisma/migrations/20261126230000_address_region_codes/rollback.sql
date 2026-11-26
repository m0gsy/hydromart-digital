-- Undoes 20261126230000_address_region_codes. LOSSY only for the codes written since; every pin stays
-- and scripts/backfill-address-regions.mjs can derive them again.

ALTER TABLE "addresses" DROP COLUMN IF EXISTS "regionSource";
ALTER TABLE "addresses" DROP COLUMN IF EXISTS "kelurahanCode";
ALTER TABLE "addresses" DROP COLUMN IF EXISTS "kecamatanCode";
