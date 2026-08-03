-- Rollback for 20260802120000_meter_reading.
--
-- LOSSY: every recorded water-meter reading is deleted, and with it the volume basis for
-- reconciling produced litres against sold litres. The per-line gallon flags go too, which
-- is what the reconciliation counts.
DROP TABLE IF EXISTS "meter_readings";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "volumeMl";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "isGallon";
