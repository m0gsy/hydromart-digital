-- HD-6 H4 part 2: the AI read API counts the subscriptions made inside a month (O-08).
-- One index on a column that already exists, built CONCURRENTLY by scripts/create-indexes.sh first.
CREATE INDEX IF NOT EXISTS "subscriptions_createdAt_idx" ON "subscriptions"("createdAt");
