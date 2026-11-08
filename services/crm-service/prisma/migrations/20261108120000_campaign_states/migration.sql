-- RERUNNABLE: ADD VALUE IF NOT EXISTS.
-- CRM-02/CRM-04, step 1 of 2: the states only. Nothing reads or writes them yet.
--   RecipientStatus.SKIPPED            a recipient who opted out / has no inbox: not a delivery failure
--   CampaignStatus.COMPLETED_WITH_FAILURES   finished, but some recipients failed (or none were reached)
--   CampaignStatus.CANCELLED           stopped by staff before it finished
-- The service code that uses them ships one release after this is applied, so a rolled-back
-- deploy never meets an enum value its database does not know. Each ADD VALUE runs on its own.
ALTER TYPE "RecipientStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'COMPLETED_WITH_FAILURES';
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
