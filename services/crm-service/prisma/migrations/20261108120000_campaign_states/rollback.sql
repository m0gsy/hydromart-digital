-- Rollback for 20261108120000_campaign_states.
--
-- Postgres cannot drop a single value from an enum type. The labels SKIPPED,
-- COMPLETED_WITH_FAILURES and CANCELLED are deliberately LEFT on the types: removing them
-- means recreating each type and rewriting every column that uses it, under a lock, to delete
-- labels nothing references. Re-applying the migration is a no-op (ADD VALUE IF NOT EXISTS).
--
-- This migration itself wrote no rows, so nothing needs undoing. If the step-2 code has
-- already run, resolve any rows that use the new labels first, or the old code will read a
-- status its enum does not contain:
UPDATE "campaign_recipients" SET "status" = 'FAILED' WHERE "status" = 'SKIPPED';
UPDATE "campaigns" SET "status" = 'SENT' WHERE "status" IN ('COMPLETED_WITH_FAILURES', 'CANCELLED');
