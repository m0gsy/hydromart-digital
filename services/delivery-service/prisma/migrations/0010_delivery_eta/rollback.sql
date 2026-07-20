-- Rollback 0010_delivery_eta
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "estimatedArrivalAt";
