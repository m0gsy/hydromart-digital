-- Rollback for 20260930110000_order_tracking_token.
DROP INDEX IF EXISTS "orders_trackingToken_key";
ALTER TABLE "orders" DROP COLUMN "trackingToken";
