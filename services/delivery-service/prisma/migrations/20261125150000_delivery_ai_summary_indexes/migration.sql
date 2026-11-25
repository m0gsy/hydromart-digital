-- HD-6 H3: the AI read API counts failed deliveries by failure time per depot and reschedules by
-- when they happened. On production both are built CONCURRENTLY before this migration runs
-- (scripts/create-indexes.sh, audit H-39); here they are IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS "deliveries_depotId_failedAt_idx" ON "deliveries"("depotId", "failedAt");
CREATE INDEX IF NOT EXISTS "delivery_status_history_status_createdAt_idx" ON "delivery_status_history"("status", "createdAt");
