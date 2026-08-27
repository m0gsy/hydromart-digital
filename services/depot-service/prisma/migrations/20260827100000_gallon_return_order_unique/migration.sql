-- RERUNNABLE: every statement is IF NOT EXISTS or matches nothing on a second run. Re-running
-- after a failure is a no-op, never a second index and never a second archive row.
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

-- ---------------------------------------------------------------------------
-- Reconciliation, decided by the owner on 27 Aug 2026.
--
-- If live data already holds two returns for one order, money has already been refunded
-- twice. The first version of this migration REFUSED in that case and named the orders,
-- which is the conservative reading; the owner's instruction is to reconcile instead —
-- keep the first booking per order, drop the rest — so the release is not held by a
-- disclosure that has already happened.
--
-- What that must NOT mean is money quietly disappearing. This is an append-only ledger,
-- and a DELETE against it with no trace would leave the depot's books unexplainable: a
-- balance that changed with nothing saying why. So every row is copied into
-- `gallon_returns_duplicate_archive` as JSON BEFORE it is deleted, and the deploy log is
-- told how many. Nothing is lost; it stops counting, and stays readable.
--
-- "The first" is by (createdAt, id): the earliest booking is the one the courier actually
-- made, and the later ones are the queue's retries of it.
CREATE TABLE IF NOT EXISTS "gallon_returns_duplicate_archive" (
  "id"         UUID PRIMARY KEY,
  "orderId"    UUID NOT NULL,
  "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reason"     TEXT NOT NULL,
  -- The whole row as it stood. A column list here would go stale the first time the table
  -- grows a column, and an archive that silently stops copying a field is worse than none.
  "row"        JSONB NOT NULL
);

COMMENT ON TABLE "gallon_returns_duplicate_archive" IS
  'MONEY-04: duplicate courier gallon-return rows removed when the unique index on orderId was introduced. Each row is one deposit refund that was booked more than once for the same order. Kept for reconciliation; nothing reads it.';

DO $$
DECLARE
  moved INT;
BEGIN
  WITH ranked AS (
    SELECT
      g.*,
      row_number() OVER (
        PARTITION BY g."orderId"
        ORDER BY g."createdAt" ASC, g."id" ASC
      ) AS n
    FROM "gallon_returns" g
    WHERE g."orderId" IS NOT NULL
  ),
  dupes AS (
    SELECT * FROM ranked WHERE n > 1
  ),
  archived AS (
    INSERT INTO "gallon_returns_duplicate_archive" ("id", "orderId", "reason", "row")
    SELECT
      d."id",
      d."orderId",
      'duplicate courier return for the same order; the first booking was kept',
      to_jsonb(d) - 'n'
    FROM dupes d
    -- Re-runnable: a row already archived is not archived twice.
    ON CONFLICT ("id") DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO moved FROM archived;

  DELETE FROM "gallon_returns" g
   WHERE g."id" IN (SELECT "id" FROM "gallon_returns_duplicate_archive");

  IF moved > 0 THEN
    RAISE NOTICE
      'MONEY-04: % duplicate gallon return(s) archived to gallon_returns_duplicate_archive and removed. Each one was a deposit refunded more than once for the same order — read that table to reconcile.',
      moved;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "gallon_returns_orderId_key" ON "gallon_returns"("orderId");

-- The plain @@index this replaces is now redundant: a unique index on the same single
-- column serves every lookup the old one did.
DROP INDEX IF EXISTS "gallon_returns_orderId_idx";
