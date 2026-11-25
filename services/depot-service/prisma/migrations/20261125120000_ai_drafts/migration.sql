-- RERUNNABLE: HD-17 part A, drafts the AI web makes (price proposal PENDING, purchase order DRAFT).
-- Expand-only: existing rows read as STAFF, nothing is rewritten. `aiSuggestionId` is the AI web's
-- X-AI-Suggestion-Id; UNIQUE so a retried call finds its own row instead of making a second one.
-- Both tables are small (one row per proposal / purchase order), so the plain unique index is cheap.
DO $$ BEGIN
  CREATE TYPE "DraftSource" AS ENUM ('STAFF', 'AI');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "price_override_proposals"
  ADD COLUMN IF NOT EXISTS "source" "DraftSource" NOT NULL DEFAULT 'STAFF',
  ADD COLUMN IF NOT EXISTS "aiSuggestionId" UUID,
  ADD COLUMN IF NOT EXISTS "aiReason" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "price_override_proposals_aiSuggestionId_key"
  ON "price_override_proposals"("aiSuggestionId");

ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "source" "DraftSource" NOT NULL DEFAULT 'STAFF',
  ADD COLUMN IF NOT EXISTS "aiSuggestionId" UUID,
  ADD COLUMN IF NOT EXISTS "aiReason" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_aiSuggestionId_key"
  ON "purchase_orders"("aiSuggestionId");
