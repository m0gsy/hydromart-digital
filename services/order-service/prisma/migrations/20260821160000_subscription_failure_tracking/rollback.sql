-- Rollback for 20260821160000_subscription_failure_tracking.
-- LOSSY: discards how many consecutive cycles each subscription has failed and why. A
-- subscription that D2b had paused stays PAUSED — the pause is a status, not one of these
-- columns — but nothing then records the reason it was paused, and nobody can tell a plan
-- the customer paused from one the sweep gave up on. Export before running:
--   SELECT id, "failureCount", "lastFailureAt", "lastFailure"
--     FROM subscriptions WHERE "failureCount" > 0;
ALTER TABLE "subscriptions"
  DROP COLUMN IF EXISTS "failureCount",
  DROP COLUMN IF EXISTS "lastFailureAt",
  DROP COLUMN IF EXISTS "lastFailure";
