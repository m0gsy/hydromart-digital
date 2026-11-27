-- RERUNNABLE: AREA-1b (2026-11-28). A do-not-contact wipe gives the emptied row its own purge clock
-- (12 months from the wipe), because suppressing is not salesperson activity and never moves lastActivityAt.
-- Nullable column, no index: only the nightly purge reads it, on a small table.
ALTER TABLE "b2b_prospects" ADD COLUMN IF NOT EXISTS "suppressedAt" TIMESTAMP(3);
