-- Rollback of 20261125150000_delivery_ai_summary_indexes: the indexes only speed reads up.
DROP INDEX IF EXISTS "deliveries_depotId_failedAt_idx";
DROP INDEX IF EXISTS "delivery_status_history_status_createdAt_idx";
