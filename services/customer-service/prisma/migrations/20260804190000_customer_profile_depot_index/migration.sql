-- Audit DB-2: customer_profiles had no secondary index at all, and the depot CRM opens
-- with `WHERE p."favoriteDepotId" = $1` — a sequential scan of the entire customer base,
-- once per page view, growing with every signup.
--
-- On production, build this with CREATE INDEX CONCURRENTLY *before* running the migration
-- (scripts/create-indexes.sh, audit H-39).
CREATE INDEX IF NOT EXISTS "customer_profiles_favoriteDepotId_idx" ON "customer_profiles"("favoriteDepotId");
