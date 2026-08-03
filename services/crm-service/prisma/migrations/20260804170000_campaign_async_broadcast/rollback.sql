-- Rollback for 20260804170000_campaign_async_broadcast.
--
-- LOSSY AND ORDER-SENSITIVE. Postgres cannot drop a single value from an enum type, so
-- any recipient still parked in SENDING must be resolved first or the old code will read
-- a status its enum does not contain.
--
-- Moving them back to PENDING is the safe direction: a claimed-but-unsent recipient has
-- not been messaged (the status flips before the send, and a successful send overwrites
-- it with SENT), so re-queueing at worst re-attempts, and the old synchronous send path
-- processes PENDING rows exactly as it always did.
UPDATE "campaign_recipients" SET "status" = 'PENDING' WHERE "status" = 'SENDING';

DROP INDEX IF EXISTS "campaigns_status_createdAt_idx";

-- The unused 'SENDING' label is deliberately LEFT on the enum type. Removing it means
-- recreating the type and rewriting every column that uses it, under a lock, to delete a
-- label nothing references. Re-applying the migration is then a no-op, which is why the
-- forward migration uses ADD VALUE IF NOT EXISTS.
