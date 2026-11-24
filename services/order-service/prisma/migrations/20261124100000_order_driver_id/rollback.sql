-- Undoes 20261124100000_order_driver_id.
--
-- LOSSY only for the courier id: every order keeps its driverName snapshot, and the daily
-- report goes back to grouping couriers by name.

ALTER TABLE "orders" DROP COLUMN IF EXISTS "driverId";
