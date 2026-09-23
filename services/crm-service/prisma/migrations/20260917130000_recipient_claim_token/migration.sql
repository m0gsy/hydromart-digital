-- CRM-9: a recipient claim owned by one sweep, and reclaimable when that sweep died.
-- Additive and nullable. Rows already SENDING have no claimedAt and are treated as stale,
-- which is exactly the stranded state this exists to recover.
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "claimToken" TEXT;
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
