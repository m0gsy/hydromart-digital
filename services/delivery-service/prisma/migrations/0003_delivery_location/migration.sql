-- 0003_delivery_location
ALTER TABLE "deliveries" ADD COLUMN "lastLat" DOUBLE PRECISION;
ALTER TABLE "deliveries" ADD COLUMN "lastLng" DOUBLE PRECISION;
ALTER TABLE "deliveries" ADD COLUMN "lastLocationAt" TIMESTAMP(3);
