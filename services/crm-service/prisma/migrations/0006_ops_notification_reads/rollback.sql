-- Manual rollback for 0006_ops_notification_reads (crm-service).
-- Drops the per-staff read receipts. Destructive: read state is not recoverable, but the
-- `notifications` audit rows themselves are untouched (the FK is ON DELETE CASCADE in the
-- other direction only).
DROP TABLE IF EXISTS "ops_notification_reads";
