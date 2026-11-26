-- Rollback for 20261128100000_depot_drafts (HD-21a).
-- NOT lossless: every depot draft, and the crmProspectId / franchiseApplicationId links on depots, are dropped.
-- Roll the code back first (the release before this one never reads these), then run this.
DROP INDEX IF EXISTS "depots_crmProspectId_key";
ALTER TABLE "depots" DROP COLUMN IF EXISTS "crmProspectId", DROP COLUMN IF EXISTS "franchiseApplicationId";
DROP TABLE IF EXISTS "depot_drafts";
DROP TYPE IF EXISTS "DepotDraftStatus";
