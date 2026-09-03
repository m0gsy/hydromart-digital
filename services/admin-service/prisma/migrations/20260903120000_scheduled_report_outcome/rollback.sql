-- Undo of 20260903120000_scheduled_report_outcome.
--
-- Dropping these loses the outcome of the last run of each schedule, which the next sweep
-- re-stamps within one cadence. Nothing else reads them, so there is no cascade.
ALTER TABLE "scheduled_reports" DROP COLUMN IF EXISTS "lastError";
ALTER TABLE "scheduled_reports" DROP COLUMN IF EXISTS "lastRunOk";
