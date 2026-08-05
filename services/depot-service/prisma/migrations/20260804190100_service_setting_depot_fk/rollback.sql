-- Drops the FK and returns depot_id to TEXT. Lossy in one direction only: the forward
-- migration DELETEs overrides whose depot no longer exists, and this cannot bring them
-- back. Take a backup first if those rows matter (they point at nothing, so they should
-- not).
ALTER TABLE "service_settings" DROP CONSTRAINT IF EXISTS "service_settings_depot_id_fkey";

ALTER TABLE "service_settings"
  ALTER COLUMN "depot_id" TYPE TEXT USING "depot_id"::text;
