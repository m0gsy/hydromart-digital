-- RERUNNABLE: HD-17 remainder, campaign drafts the AI web makes (status DRAFT, nothing sent).
-- Expand-only: existing rows read as STAFF, nothing is rewritten. `aiSuggestionId` is the AI web's
-- X-AI-Suggestion-Id; UNIQUE so a retried call finds its own row instead of making a second one.
-- The unique index is on a column this very migration adds with every value NULL, so it builds instantly.
DO $$ BEGIN
  CREATE TYPE "DraftSource" AS ENUM ('STAFF', 'AI');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "source" "DraftSource" NOT NULL DEFAULT 'STAFF',
  ADD COLUMN IF NOT EXISTS "aiSuggestionId" UUID,
  ADD COLUMN IF NOT EXISTS "aiReason" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_aiSuggestionId_key"
  ON "campaigns"("aiSuggestionId");
