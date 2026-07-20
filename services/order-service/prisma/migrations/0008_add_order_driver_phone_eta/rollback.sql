-- Rollback 0008_add_order_driver_phone_eta
ALTER TABLE "orders" DROP COLUMN IF EXISTS "estimatedArrivalAt";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "driverPhone";
