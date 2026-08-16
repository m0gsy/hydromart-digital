-- Broadcasts no longer go out over WhatsApp. The transport is now the same one every
-- transactional notification uses: a row in the customer's in-app inbox, plus best-effort
-- push. The stored `channel` has to say so, or the HQ console reports a delivery route the
-- campaign never took.
--
-- Adding the value is all this migration does. Postgres refuses to USE a newly added enum
-- value inside the transaction that added it, and Prisma wraps each migration in one
-- transaction — so the DEFAULT change lives in the next migration
-- (20260817090100_campaign_channel_in_app_default) rather than here.
ALTER TYPE "CampaignChannel" ADD VALUE IF NOT EXISTS 'IN_APP';
