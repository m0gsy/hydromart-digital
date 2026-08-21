-- D2: a subscription cycle that fails retries forever, with no counter, no notification,
-- and no record of what went wrong.
--
-- The sweep catches every placement error and logs a warning. Nothing else. A subscription
-- whose product was pulled from the catalogue is retried on every tick, for as long as the
-- subscription exists, and the customer is never told their standing order stopped
-- arriving. The only trace is a line in a container log nobody reads.
--
-- Three columns, because "retries forever" needs all three to stop being true:
--   failureCount  — how many consecutive ticks have failed. Reset to 0 on any success, so
--                   it measures a CURRENT outage, not a lifetime tally.
--   lastFailureAt — when the run of failures started being a problem.
--   lastFailure   — what actually went wrong, in words, so a human has something to act on.
--
-- All nullable / defaulted: every existing subscription is healthy until proven otherwise,
-- which is the honest reading of "we were not counting".
--
-- Written and nothing more in this release. The reader — the counter that pauses a
-- subscription and tells the customer — is D2b. Schema rule: a column ships one release
-- before the code that reads it.
-- AlterTable
ALTER TABLE "subscriptions"
  ADD COLUMN "failureCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastFailureAt" TIMESTAMP(3),
  ADD COLUMN "lastFailure"   TEXT;
