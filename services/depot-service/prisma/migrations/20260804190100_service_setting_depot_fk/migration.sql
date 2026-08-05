-- Audit DB-5: service_settings.depot_id pointed at a depot with nothing enforcing that the
-- depot exists. A typo'd or stale id produced an override that silently applied to nobody,
-- and deleting a depot left its overrides behind to be re-attached to the next depot that
-- happened to reuse the id.
--
-- Two steps, because the column was TEXT while depots.id is UUID:
--   1. widen to uuid (every non-null value is already a uuid string — GLOBAL rows are null)
--   2. add the FK, cascading so a deleted depot takes its own overrides with it.
--
-- If step 1 raises `invalid input syntax for type uuid`, a row holds a non-uuid depot_id.
-- Find it before re-running — it is a defect, not a migration problem:
--   SELECT id, scope, depot_id, key FROM service_settings
--    WHERE depot_id IS NOT NULL AND depot_id !~ '^[0-9a-f-]{36}$';
ALTER TABLE "service_settings"
  ALTER COLUMN "depot_id" TYPE uuid USING "depot_id"::uuid;

-- An override pointing at a depot that no longer exists cannot be adopted by the FK, so
-- clear those first rather than failing the whole migration on historical rubbish.
DELETE FROM "service_settings"
 WHERE "depot_id" IS NOT NULL
   AND "depot_id" NOT IN (SELECT "id" FROM "depots");

ALTER TABLE "service_settings"
  ADD CONSTRAINT "service_settings_depot_id_fkey"
  FOREIGN KEY ("depot_id") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
