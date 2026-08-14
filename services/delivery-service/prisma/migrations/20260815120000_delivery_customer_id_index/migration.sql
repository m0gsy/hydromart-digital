-- The feed read: this customer's deliveries, newest first.
--
-- A release later than the column on purpose. `create-indexes.sh` builds it CONCURRENTLY
-- before migrations run, and it can only do that once the column exists — the previous
-- release's deploy failed exactly here, and refused to let the migration build the index
-- under a lock instead. IF NOT EXISTS so this finds the concurrent build already done.
CREATE INDEX IF NOT EXISTS "deliveries_customerId_createdAt_idx" ON "deliveries" ("customerId", "createdAt" DESC);
