-- Rollback for 20261126191000_campaign_depot (HD-14). Drops which depot a campaign belonged to; nothing else reads it.
-- Roll the code back first (the release before this one never reads it), then run this.
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "depotId";
