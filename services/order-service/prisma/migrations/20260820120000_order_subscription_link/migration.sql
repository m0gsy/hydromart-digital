-- D6: a subscription delivery could not be traced back to the subscription that made it.
--
-- The only link was the idempotency string the sweep happens to build, `sub:<id>:<iso>`.
-- That string is exposed on no read model and is not a relation anybody can query, so
-- "which orders did this subscription produce?" had no answer — and D1 needs one: excluding
-- scheduled orders from the abandonment sweep by pattern-matching a key would rest a money
-- predicate on a naming convention.
--
-- Nullable, because almost every order has no subscription and never will. No foreign key:
-- subscriptions live in the same service today but the id is carried as data, the same way
-- depotId is, so a subscription deleted for retention does not take its order history with
-- it. See the RERUNNABLE backfill at the bottom.
--
-- Schema release rule: this column ships one release BEFORE the code that reads it. Nothing
-- in this release consumes it — the writer is here, the reader (D1) is not.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT;

-- On production, build this index with CREATE INDEX CONCURRENTLY *before* running the
-- migration (scripts/create-indexes.sh, audit H-39). This statement then finds it already
-- there and does nothing; on a fresh database it builds it outright.
CREATE INDEX IF NOT EXISTS "orders_subscriptionId_createdAt_idx" ON "orders"("subscriptionId", "createdAt");

-- RERUNNABLE: backfills the link for orders placed before the column existed, from the one
-- place the information survives — the sweep's own idempotency key. The pattern is exact
-- (`sub:` + a uuid + `:` + an ISO timestamp), so a customer-supplied key cannot match it
-- by accident: those come from the client and are opaque. Safe to run twice; it only ever
-- fills a NULL.
UPDATE "orders"
   SET "subscriptionId" = split_part("idempotencyKey", ':', 2)
 WHERE "subscriptionId" IS NULL
   AND "idempotencyKey" ~ '^sub:[0-9a-fA-F-]{36}:';
