-- Rollback for 20260718112936_add_delivery_window.
-- LOSSY: the delivery window a customer chose at checkout is discarded on every order,
-- including ones not yet delivered.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "deliveryWindow";
