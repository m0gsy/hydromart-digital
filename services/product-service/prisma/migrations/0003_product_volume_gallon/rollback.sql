-- Rollback for 0003_product_volume_gallon.
--
-- LOSSY: per-product volume in millilitres is discarded and cannot be re-derived. The
-- isGallon flag can be rebuilt (the forward migration backfilled it from the unit label
-- with `lower(btrim(unit)) LIKE 'galon%'`), but any product whose flag was corrected by
-- hand afterwards loses that correction.
--
-- Meter reconciliation and the delivery-fee rule both read these columns, so run this only
-- alongside a code rollback that predates them.
ALTER TABLE "products" DROP COLUMN IF EXISTS "isGallon";
ALTER TABLE "products" DROP COLUMN IF EXISTS "volumeMl";
