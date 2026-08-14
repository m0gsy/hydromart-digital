-- Scheduled reports had full CRUD and no executor at all: `nextRunAt` was documented as
-- "advisory metadata for the future scheduler", and nothing ever ran. Two things were
-- missing before one could.
--
-- 1. WHICH report. The row carried a name, a cadence, a format and recipients — but nothing
--    that said what to put in the file. The three values match the three groupings
--    hq/reports/export already draws from real endpoints; anything else would be a picker
--    for data nobody can fetch.
CREATE TYPE "ReportDataset" AS ENUM ('REVENUE_BY_DEPOT', 'REVENUE_BY_PRODUCT', 'REVENUE_BY_METHOD');

ALTER TABLE "scheduled_reports"
  ADD COLUMN "dataset" "ReportDataset" NOT NULL DEFAULT 'REVENUE_BY_DEPOT',
  ADD COLUMN "lastRunAt" TIMESTAMP(3);

-- The sweep's query shape: enabled rows that are due, oldest first. Without it every tick
-- scans the table.
CREATE INDEX IF NOT EXISTS "scheduled_reports_enabled_nextRunAt_idx"
  ON "scheduled_reports"("enabled", "nextRunAt");

-- 2. The FILE. `export_logs` recorded that an export happened and never held one, so
--    hq/exports could only ever be a list of claims. The bytes live in the row: a revenue
--    aggregate is hundreds of KB, it is already inside the DB backup, and it needs no new
--    volume, bucket or credential to exist. Retention is the price — the purge sweep that
--    already trims this table is what keeps it from growing forever.
ALTER TABLE "export_logs"
  ADD COLUMN "content" BYTEA,
  ADD COLUMN "fileName" TEXT;
