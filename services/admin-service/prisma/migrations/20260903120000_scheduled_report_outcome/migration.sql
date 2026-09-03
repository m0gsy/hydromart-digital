-- RERUNNABLE: both statements are ADD COLUMN IF NOT EXISTS, so a retry after a deploy that
-- died mid-migrate is a no-op rather than a hand-resolved failure.
--
-- CA-2-66: a scheduled report that failed looked exactly like one that worked.
--
-- `scheduled_reports.last_run_at` is stamped by the sweep whether the run succeeded or
-- not — deliberately, so a schedule that fails every tick does not become a hot loop. The
-- screen then printed "terakhir jalan: <timestamp>" and stopped there. Head office set up
-- a weekly revenue report, saw a fresh timestamp every Monday, and had no way to learn
-- that the file had not been produced for a month.
--
-- The runner has always KNOWN: `runOne` returns a boolean and writes a FAILED row to the
-- export log. What was missing is a place on the schedule itself to put the answer, so the
-- list screen can show it without joining every row against the log.
--
-- Both columns are nullable, and null means "never run" — the same thing `last_run_at`
-- being null has always meant. Old code ignores them, so the rebuild window during which
-- some services still run the previous image is safe.
ALTER TABLE "scheduled_reports" ADD COLUMN IF NOT EXISTS "lastRunOk" BOOLEAN;
ALTER TABLE "scheduled_reports" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
