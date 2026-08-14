-- Rollback for 20260813120000_campaign_scheduled_for.
--
-- LOSSY: every scheduled send time is dropped. A campaign that was claimed for a future
-- date becomes indistinguishable from one due immediately, so after this rollback the
-- sweep will send it on its very next tick. If that matters, cancel the scheduled
-- campaigns (set them back to DRAFT) BEFORE rolling back, not after.
DROP INDEX IF EXISTS "campaigns_scheduledFor_idx";
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "scheduledFor";
