-- Rollback for 20260811000000_reseller_flat_price_photo.
-- LOSSY AND PRICE-AFFECTING: every reseller on a flat per-gallon price reverts to their
-- percentage (usually 0 = list price) at the next checkout, and the registration photos
-- are dropped from the record while the uploaded files stay in the bucket. Export both
-- columns before running this.
ALTER TABLE "reseller_profiles" DROP COLUMN IF EXISTS "flatGallonPriceIdr";
ALTER TABLE "reseller_profiles" DROP COLUMN IF EXISTS "photoUrl";
