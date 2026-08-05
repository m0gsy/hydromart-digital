-- Rollback for 20260725205545_reseller_discount_pct.
-- LOSSY AND PRICE-AFFECTING: each reseller's negotiated discount percentage is discarded,
-- so every one of them silently reverts to list price at the next checkout. Export the
-- column before running this.
ALTER TABLE "reseller_profiles" DROP COLUMN IF EXISTS "discountPct";
