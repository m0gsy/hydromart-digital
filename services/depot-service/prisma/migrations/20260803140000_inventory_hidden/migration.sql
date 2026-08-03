-- A stock line whose catalog product was deactivated is kept, not deleted: its movement
-- ledger is the depot's record of what it once sold, and an order still in flight has to
-- settle against it. It is only hidden from the operator's list, so a product nobody
-- sells any more stops asking to be counted at every stock opname.
--
-- Default false, so every existing line stays visible; product-service sets it on the
-- lines of a product it deactivates.
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;

-- The operator list filters on (depotId, hidden); the partial index keeps that lookup on
-- the visible rows only, which is the overwhelming majority.
CREATE INDEX IF NOT EXISTS "inventory_items_depotId_visible_idx"
  ON "inventory_items" ("depotId")
  WHERE "hidden" = false;
