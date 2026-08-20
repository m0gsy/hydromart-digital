-- Rollback for 20260821090000_gallon_issue_order_link.
-- LOSSY: the link from each fulfilment-written issue back to the order that created it is
-- discarded, and with it the only thing that keeps a re-delivered completion event from
-- booking the same deposit twice. Export the column before running this, and turn the
-- fulfilment writer off first (it has nothing to be idempotent against without it).
DROP INDEX IF EXISTS "gallon_issues_orderId_key";
ALTER TABLE "gallon_issues" DROP COLUMN IF EXISTS "orderId";
