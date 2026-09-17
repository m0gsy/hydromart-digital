-- Rollback for 20260917130000_recipient_claim_token. Deploy the previous image first:
-- this release writes both columns on every claim.
ALTER TABLE "campaign_recipients" DROP COLUMN IF EXISTS "claimedAt";
ALTER TABLE "campaign_recipients" DROP COLUMN IF EXISTS "claimToken";
