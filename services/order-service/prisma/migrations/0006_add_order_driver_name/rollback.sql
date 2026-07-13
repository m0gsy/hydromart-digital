-- Rollback 0006_add_order_driver_name
ALTER TABLE "orders" DROP COLUMN IF EXISTS "driverName";
