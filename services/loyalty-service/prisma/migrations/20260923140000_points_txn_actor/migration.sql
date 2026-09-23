-- LOY-2: a manual points correction recorded no actor, so minted points were untraceable.
--
-- Nullable with no backfill: rows written before this column existed have no actor, and
-- inventing one would be worse than admitting the gap. No index — the ledger is read by
-- customer, and this column is evidence on a row already found.
ALTER TABLE "points_transactions" ADD COLUMN "createdBy" TEXT;
