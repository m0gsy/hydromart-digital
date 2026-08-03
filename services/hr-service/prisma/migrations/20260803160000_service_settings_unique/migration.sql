-- H-11: service_settings had no unique key, so two concurrent saves of the same setting
-- wrote two rows. loadAll() then read both and whichever the scan happened to return last
-- won — a per-depot price, rate or fee silently flapping between two values with nothing
-- in the UI to show why. The repository comment already said it was "emulating the
-- partial-unique target"; the index it was emulating never existed.
--
-- Two partial indexes, not one @@unique: depotId is nullable and Postgres treats every
-- NULL as distinct, so a plain unique over (scope, depotId, key) would not constrain the
-- GLOBAL rows at all — exactly the ones every depot falls back to.

-- Existing duplicates must go first or the index cannot be built. The newest row wins:
-- it is the value somebody saved last, and the read it replaces was picking arbitrarily.
DELETE FROM "service_settings" a
      USING "service_settings" b
      WHERE a."updatedAt" < b."updatedAt"
        AND a."key" = b."key"
        AND a."depotId" IS NOT DISTINCT FROM b."depotId";

CREATE UNIQUE INDEX "service_settings_global_key_key"
  ON "service_settings" ("key")
  WHERE "depotId" IS NULL;

CREATE UNIQUE INDEX "service_settings_depot_key_key"
  ON "service_settings" ("depotId", "key")
  WHERE "depotId" IS NOT NULL;
