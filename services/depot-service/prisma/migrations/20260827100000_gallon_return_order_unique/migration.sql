-- RERUNNABLE: creates one index IF NOT EXISTS and raises only on data it must not silently
-- accept. Re-running after a failure is a no-op, never a second index.
--
-- MONEY-04: the deposit refund had no idempotency key.
--
-- gallon_issues.orderId has been UNIQUE since I1, with a comment explaining that the
-- completion fan-out is at-least-once and a second booking would inflate what the depot
-- appears to hold. The refund half — the half that pays money OUT — had only @@index.
--
-- The courier handover reaches this table through the web app's offline capture queue
-- (`kind: 'gallonReturn'`, apps/web/src/lib/offline-queue.ts). That queue retries anything
-- it cannot confirm: a POST whose response is lost to a 15s timeout at a customer's door,
-- or to a 502 during a deploy, is re-sent on the next flush. The server had already
-- committed the first row. The retry wrote a second, and the customer's deposit came back
-- twice.
--
-- NULLs stay distinct in Postgres, so a walk-in counter return (orderId NULL) is
-- unconstrained — the same partial-by-nature shape gallon_issues uses.
--
-- The guard below is deliberate and deliberately loud. If live data ALREADY holds two
-- returns for one order then money has already been refunded twice, and that is a fact a
-- person must see and reconcile — not something a migration should paper over by silently
-- skipping the index. It names the orders so the reconciliation has somewhere to start.
DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(DISTINCT "orderId"::text, ', ')
    INTO dupes
    FROM (
      SELECT "orderId"
        FROM "gallon_returns"
       WHERE "orderId" IS NOT NULL
       GROUP BY "orderId"
      HAVING count(*) > 1
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'MONEY-04: gallon_returns already holds more than one return for these orders, so a deposit has been refunded more than once: %. Reconcile them (keep the first row per order) before this unique index can be built.',
      dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "gallon_returns_orderId_key" ON "gallon_returns"("orderId");

-- The plain @@index this replaces is now redundant: a unique index on the same single
-- column serves every lookup the old one did.
DROP INDEX IF EXISTS "gallon_returns_orderId_idx";
