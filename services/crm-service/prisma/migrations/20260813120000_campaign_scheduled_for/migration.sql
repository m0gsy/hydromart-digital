-- "Jadwalkan" was a button with nothing behind it: both it and "Kirim sekarang" produced
-- the same immediate draft, and the compose screens refused a send time with a toast while
-- still showing the control. A campaign can now carry the time it is due.
--
-- Nullable on purpose: NULL means "as soon as the sweep sees it", which is exactly what
-- every campaign written before this migration meant. No backfill, no behaviour change for
-- rows already in flight.
ALTER TABLE "campaigns" ADD COLUMN "scheduledFor" TIMESTAMP(3);

-- The sweep asks "still SENDING, due, oldest first". The existing (status, createdAt) index
-- still serves the first and the last; this partial index keeps the due-check from turning
-- into a scan once scheduled campaigns pile up.
--
-- On production, build this with CREATE INDEX CONCURRENTLY *before* running the migration
-- (scripts/create-indexes.sh, audit H-39).
CREATE INDEX IF NOT EXISTS "campaigns_scheduledFor_idx" ON "campaigns"("scheduledFor")
  WHERE "scheduledFor" IS NOT NULL;
