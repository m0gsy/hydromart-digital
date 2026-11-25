-- HD-6 H4 part 2: the AI read API asks for redemptions handed over per depot and day (O-02), and for
-- the points ledger and the accounts as they stood before a date (O-04). Three indexes, on columns
-- that already exist, so they are built CONCURRENTLY by scripts/create-indexes.sh before this runs.
CREATE INDEX IF NOT EXISTS "reward_redemptions_depotId_status_usedAt_idx" ON "reward_redemptions"("depotId", "status", "usedAt");
CREATE INDEX IF NOT EXISTS "points_transactions_createdAt_idx" ON "points_transactions"("createdAt");
CREATE INDEX IF NOT EXISTS "loyalty_accounts_createdAt_idx" ON "loyalty_accounts"("createdAt");
