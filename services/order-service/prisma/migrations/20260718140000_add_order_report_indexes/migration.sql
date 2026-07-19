-- Audit DB-3: back reporting + paginated-list queries that filter/sort on createdAt.
CREATE INDEX IF NOT EXISTS "orders_createdAt_idx" ON "orders"("createdAt");
CREATE INDEX IF NOT EXISTS "orders_status_createdAt_idx" ON "orders"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_depotId_createdAt_idx" ON "orders"("depotId", "createdAt");
