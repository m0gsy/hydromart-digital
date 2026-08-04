-- Restores the three single-column indexes and drops the composite. Lossless: indexes
-- carry no data. Rebuilding them locks writes on "orders" for the duration — use the
-- CONCURRENTLY form below on a live database instead of this file if the table is large.
--
--   CREATE INDEX CONCURRENTLY "orders_customerId_idx" ON "orders"("customerId");
--   CREATE INDEX CONCURRENTLY "orders_status_idx"     ON "orders"("status");
--   CREATE INDEX CONCURRENTLY "orders_depotId_idx"    ON "orders"("depotId");
CREATE INDEX IF NOT EXISTS "orders_customerId_idx" ON "orders"("customerId");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders"("status");
CREATE INDEX IF NOT EXISTS "orders_depotId_idx" ON "orders"("depotId");

DROP INDEX IF EXISTS "orders_customerId_createdAt_idx";
