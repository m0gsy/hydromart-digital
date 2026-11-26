-- RERUNNABLE: HD-20a (2026-11-26). Additive and nullable: an address without a pin, or with a pin too
-- coarse to name a place, has no region code. Filled server-side from the pin; backfill is
-- scripts/backfill-address-regions.mjs. No index here: nothing queries by these yet (HD-20b will, and
-- its index goes through scripts/create-indexes.sh).

-- BPS code of the kecamatan (ADM3, 7 digits) and kelurahan/desa (ADM4, 10 digits) the pin is in.
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "kecamatanCode" TEXT;
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "kelurahanCode" TEXT;
-- Where the codes came from ('PIN' = point-in-polygon on the address pin).
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "regionSource" TEXT;
