-- Rollback for 20261125120000_ai_read_indexes. Indexes only: nothing is lost, the AI read API
-- just answers more slowly (or, past its row caps, with a refusal) until they are rebuilt.
DROP INDEX IF EXISTS "reward_redemptions_depotId_status_usedAt_idx";
DROP INDEX IF EXISTS "points_transactions_createdAt_idx";
DROP INDEX IF EXISTS "loyalty_accounts_createdAt_idx";
