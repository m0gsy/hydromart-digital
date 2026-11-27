-- Undoes 20261128091000_b2b_prospect_suppressed_at. Wiped rows then fall back to lastActivityAt for retention.
ALTER TABLE "b2b_prospects" DROP COLUMN IF EXISTS "suppressedAt";
