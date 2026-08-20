-- Undoes D6. Drops the column and its index.
--
-- LOSSY in one narrow way, and worth saying plainly: the column is dropped with whatever
-- was in it, so any link written for an order whose idempotency key does NOT match the
-- `sub:<uuid>:<iso>` pattern is gone for good. Every link this release writes does match it
-- (the sweep builds both from the same subscription), so re-running the migration restores
-- the same values — but a later release that starts stamping subscriptionId from some other
-- path would not be recoverable this way.
--
-- Dropping the index locks writes on "orders" for the duration. On a live database use:
--   DROP INDEX CONCURRENTLY "orders_subscriptionId_createdAt_idx";
DROP INDEX IF EXISTS "orders_subscriptionId_createdAt_idx";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "subscriptionId";
