-- B3: the stalled-order sweep cancels orders by how old they ARE, not by how long they
-- have been stuck.
--
-- `findStaleIn` filters on `createdAt`. For the CREATED window that happens to be the same
-- thing, because an order enters CREATED at the moment it is created. For the
-- CONFIRMED/PREPARING window it is not the same thing at all: an order placed 25 hours ago
-- and accepted by the depot ONE MINUTE ago is already past `stalledHours`, so the very next
-- sweep tick auto-cancels it and releases its stock — out from under a depot that had just
-- started work on it. The longer an order legitimately waits before a depot picks it up,
-- the more certain it is to be killed the instant the depot does.
--
-- One column: when the order last entered its current status. Defaulted to now() so a new
-- order is correct from birth, and backfilled below so existing rows are not all treated as
-- having just moved.
--
-- Backfill order matters. The status history is the truth where it exists, so the newest
-- history row for each order wins; orders predating history, or whose history was pruned,
-- fall back to `createdAt` — which is exactly the value the sweep uses today, so those rows
-- keep their current behaviour rather than silently changing it.
--
-- Written and nothing more in this release: the sweep still reads `createdAt`. The reader is
-- B3b. Schema rule — a column ships one release before the code that reads it.

-- AlterTable
ALTER TABLE "orders"
  ADD COLUMN "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: newest history entry per order, else the order's own createdAt.
UPDATE "orders" o
   SET "statusChangedAt" = COALESCE(h."latest", o."createdAt")
  FROM (
    SELECT "orderId", MAX("createdAt") AS "latest"
      FROM "order_status_history"
     GROUP BY "orderId"
  ) h
 WHERE h."orderId" = o."id";

UPDATE "orders"
   SET "statusChangedAt" = "createdAt"
 WHERE "id" NOT IN (SELECT DISTINCT "orderId" FROM "order_status_history");

-- No index here, and that is the guard talking, not an oversight: an index cannot be
-- pre-built CONCURRENTLY on a column that does not exist yet. `(status, statusChangedAt)`
-- ships with B3b — the release that actually reads it — through scripts/create-indexes.sh.
