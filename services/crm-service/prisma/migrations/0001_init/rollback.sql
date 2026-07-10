-- Rollback for 0001_init.
DROP TABLE IF EXISTS "campaign_recipients";
DROP TABLE IF EXISTS "campaigns";
DROP TYPE IF EXISTS "RecipientStatus";
DROP TYPE IF EXISTS "CampaignChannel";
DROP TYPE IF EXISTS "CampaignStatus";
