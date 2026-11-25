-- Rollback for 20261126120000_ai_campaign_drafts (HD-17 remainder).
-- NOT lossless: the "Usulan AI" marker, the AI web's suggestion id and the AI's reason are dropped.
-- The campaigns themselves stay as ordinary ones (they then read as staff-made).
-- Roll the code back first (the release before this one never reads these columns), then run this.
DROP INDEX IF EXISTS "campaigns_aiSuggestionId_key";
ALTER TABLE "campaigns"
  DROP COLUMN IF EXISTS "aiReason",
  DROP COLUMN IF EXISTS "aiSuggestionId",
  DROP COLUMN IF EXISTS "source";

DROP TYPE IF EXISTS "DraftSource";
