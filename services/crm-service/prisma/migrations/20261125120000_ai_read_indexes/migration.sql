-- HD-6 H4 part 2: the AI read API counts the campaigns finished inside a month (O-09), and whether any is
-- still sending. One index on columns that already exist, built CONCURRENTLY by scripts/create-indexes.sh first.
CREATE INDEX IF NOT EXISTS "campaigns_status_sentAt_idx" ON "campaigns"("status", "sentAt");
