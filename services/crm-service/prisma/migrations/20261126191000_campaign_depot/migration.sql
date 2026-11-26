-- RERUNNABLE: HD-14, a depot campaign remembers its depot so a quality hold can stop its send.
-- Expand-only: a nullable column, no index (nothing queries by it; it is read with the row). Existing
-- campaigns and network-wide (HQ) campaigns read NULL.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "depotId" UUID;
