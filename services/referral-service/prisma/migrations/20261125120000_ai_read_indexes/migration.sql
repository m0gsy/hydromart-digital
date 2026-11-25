-- HD-6 H4 part 2: the AI read API counts referrals made, and referrals qualified, inside a month (O-06).
-- Two indexes on columns that already exist, built CONCURRENTLY by scripts/create-indexes.sh first.
CREATE INDEX IF NOT EXISTS "referrals_createdAt_idx" ON "referrals"("createdAt");
CREATE INDEX IF NOT EXISTS "referrals_status_qualifiedAt_idx" ON "referrals"("status", "qualifiedAt");
