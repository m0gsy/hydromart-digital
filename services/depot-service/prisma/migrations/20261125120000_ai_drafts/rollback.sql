-- Rollback for 20261125120000_ai_drafts (HD-17 part A).
-- NOT lossless: the "Usulan AI" marker, the AI web's suggestion id and the AI's reason are dropped.
-- The drafts themselves stay as ordinary proposals / purchase orders (they then read as staff ones).
-- Roll the code back first (the release before this one never reads these columns), then run this.
DROP INDEX IF EXISTS "purchase_orders_aiSuggestionId_key";
ALTER TABLE "purchase_orders"
  DROP COLUMN IF EXISTS "aiReason",
  DROP COLUMN IF EXISTS "aiSuggestionId",
  DROP COLUMN IF EXISTS "source";

DROP INDEX IF EXISTS "price_override_proposals_aiSuggestionId_key";
ALTER TABLE "price_override_proposals"
  DROP COLUMN IF EXISTS "aiReason",
  DROP COLUMN IF EXISTS "aiSuggestionId",
  DROP COLUMN IF EXISTS "source";

DROP TYPE IF EXISTS "DraftSource";
