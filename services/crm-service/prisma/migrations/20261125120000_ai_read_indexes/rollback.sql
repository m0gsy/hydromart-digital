-- Rollback for 20261125120000_ai_read_indexes. Index only: nothing is lost.
DROP INDEX IF EXISTS "campaigns_status_sentAt_idx";
