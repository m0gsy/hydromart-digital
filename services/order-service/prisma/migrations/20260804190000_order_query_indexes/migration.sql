-- Audit DB-4: the paginated order list filters on customerId and sorts by createdAt
-- descending. With only a single-column index on customerId, Postgres reads every order
-- that customer ever placed and sorts it — the composite lets it walk the index and stop
-- at the page size.
--
-- The three single-column indexes dropped below are the leftmost prefix of a composite
-- that already exists (or is created here), so no lookup loses its index. Each one that
-- stays is another b-tree written on every INSERT into the busiest table in the system.
--
-- On production, build the new index with CREATE INDEX CONCURRENTLY *before* running
-- this migration (see scripts/create-indexes.sh, audit H-39). This statement then finds
-- it already there and does nothing; on a fresh database it builds it outright.
CREATE INDEX IF NOT EXISTS "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt");

DROP INDEX IF EXISTS "orders_customerId_idx";
DROP INDEX IF EXISTS "orders_status_idx";
DROP INDEX IF EXISTS "orders_depotId_idx";
