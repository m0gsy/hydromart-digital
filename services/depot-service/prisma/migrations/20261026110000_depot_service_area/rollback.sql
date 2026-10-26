-- Rollback for 20261026110000_depot_service_area.
-- LOSSY: every drawn service-area polygon is discarded and those depots fall back to
-- serviceRadiusKm routing. Export the column before running this.
ALTER TABLE "depots" DROP COLUMN IF EXISTS "serviceArea";
