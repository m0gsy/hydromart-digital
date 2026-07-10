-- Rollback for 0003_sale_idempotency.
DROP INDEX IF EXISTS "stock_movements_itemId_orderId_key";
ALTER TABLE "stock_movements" DROP COLUMN IF EXISTS "orderId";
