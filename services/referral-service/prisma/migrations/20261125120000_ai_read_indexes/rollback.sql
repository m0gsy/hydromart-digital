-- Rollback for 20261125120000_ai_read_indexes. Indexes only: nothing is lost.
DROP INDEX IF EXISTS "referrals_createdAt_idx";
DROP INDEX IF EXISTS "referrals_status_qualifiedAt_idx";
