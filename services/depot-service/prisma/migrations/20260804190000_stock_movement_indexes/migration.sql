-- Audit DB-1: stock_movements is the fastest-growing table in the system and carried one
-- index, on itemId alone. Every read of it is either "this item's ledger, newest first"
-- or "this depot's movements of this type inside a window" — both sort or filter on
-- createdAt, which that index could not serve.
--
-- The dropped index is the leftmost prefix of the first composite, so itemId lookups keep
-- an index; the depot only stops paying to maintain a second copy of it.
--
-- On production, build these with CREATE INDEX CONCURRENTLY *before* running this
-- migration (scripts/create-indexes.sh, audit H-39) — a plain CREATE INDEX takes a
-- write lock on the table for as long as the build runs.
CREATE INDEX IF NOT EXISTS "stock_movements_itemId_createdAt_idx" ON "stock_movements"("itemId", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_movements_type_createdAt_idx" ON "stock_movements"("type", "createdAt");

DROP INDEX IF EXISTS "stock_movements_itemId_idx";
