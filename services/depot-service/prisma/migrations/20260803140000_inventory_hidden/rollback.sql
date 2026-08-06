-- Rollback for 20260803140000_inventory_hidden.
-- LOSSY: which inventory rows a depot had hidden from its console is discarded, so every
-- hidden row becomes visible again at the next load.
DROP INDEX IF EXISTS "inventory_items_depotId_visible_idx";
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "hidden";
