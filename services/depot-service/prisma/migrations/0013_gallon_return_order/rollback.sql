-- Rollback for 0013_gallon_return_order.
DROP INDEX IF EXISTS "gallon_returns_orderId_idx";
ALTER TABLE "gallon_returns" DROP COLUMN IF EXISTS "orderId";
