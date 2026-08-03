-- Rollback for 20260718170000_inventory_singleton_unique (DB-11).
--
-- Safe for the data, but it REMOVES A GUARD: this partial unique index is what keeps a
-- depot to ONE singleton inventory row per itemType. Without it, concurrent stock writes
-- create duplicate rows, each holding part of the true quantity — which reads as stock
-- quietly vanishing.
DROP INDEX IF EXISTS "inventory_items_depotId_itemType_singleton_key";
