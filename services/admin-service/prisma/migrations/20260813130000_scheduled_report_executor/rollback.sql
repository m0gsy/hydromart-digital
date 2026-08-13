-- Rollback for 20260813130000_scheduled_report_executor.
--
-- LOSSY twice over. Dropping `content` destroys every report file the sweep has produced:
-- they live only in this column, there is no bucket or volume holding a second copy, and
-- an export log without its bytes is back to being a record that something happened
-- somewhere. Download anything still wanted before running this.
--
-- Dropping `dataset` also forgets what each schedule was FOR. The rows survive with their
-- name, cadence and recipients, but nothing then says which report to produce — which is
-- the state this migration was written to end.
ALTER TABLE "export_logs" DROP COLUMN IF EXISTS "fileName";
ALTER TABLE "export_logs" DROP COLUMN IF EXISTS "content";

DROP INDEX IF EXISTS "scheduled_reports_enabled_nextRunAt_idx";
ALTER TABLE "scheduled_reports" DROP COLUMN IF EXISTS "lastRunAt";
ALTER TABLE "scheduled_reports" DROP COLUMN IF EXISTS "dataset";

DROP TYPE IF EXISTS "ReportDataset";
