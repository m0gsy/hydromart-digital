-- Rollback for 0003_delivery_location.
-- LOSSY: the last known courier position of every delivery is discarded; live tracking
-- has nothing to render until couriers ping again.
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "lastLocationAt";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "lastLng";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "lastLat";
