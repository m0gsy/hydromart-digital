-- Rolls back 20261125120000_ai_drafts (depot-service, HD-17 part A).
-- NOT lossless: the AI marker (source), the suggestion id and the AI's reason are dropped from every
-- row. AI drafts stay as ordinary rows (a PENDING proposal, a DRAFT purchase order), they just stop
-- saying they came from the AI. Roll the code back FIRST: the release that reads these columns
-- fails on every proposal and purchase order once they are gone.
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
