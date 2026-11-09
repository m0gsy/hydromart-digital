-- Rolls back 20261109150000_export_log_client_reported.
-- Drops the flag; browser-reported entries read as ordinary ones again.
ALTER TABLE "export_logs" DROP COLUMN IF EXISTS "clientReported";
