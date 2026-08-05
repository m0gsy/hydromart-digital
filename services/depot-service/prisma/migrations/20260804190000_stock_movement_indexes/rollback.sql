-- Restores the single-column index and drops the two composites. Lossless: indexes carry
-- no data. On a live database prefer the CONCURRENTLY form so the rebuild does not block
-- stock writes:
--
--   CREATE INDEX CONCURRENTLY "stock_movements_itemId_idx" ON "stock_movements"("itemId");
CREATE INDEX IF NOT EXISTS "stock_movements_itemId_idx" ON "stock_movements"("itemId");

DROP INDEX IF EXISTS "stock_movements_itemId_createdAt_idx";
DROP INDEX IF EXISTS "stock_movements_type_createdAt_idx";
