-- Undo 20261127100000_seed_sales_roles. A role someone already holds is left alone (removing it
-- would orphan the account), and so are its grants. Only roles with no holder, no author and not
-- yet archived (the shape this migration writes) are undone: roles are archived, never deleted, so
-- the row is archived, its key leaves every capability list and its per-depot rules are dropped.
-- The override rows themselves stay: they now equal the compiled default, which is harmless.
BEGIN;

UPDATE "capability_overrides" SET "roles" = array_remove("roles", 'C_sales'), "updatedAt" = now()
WHERE "roles" @> ARRAY['C_sales']
  AND EXISTS (SELECT 1 FROM "custom_roles" WHERE "key" = 'C_sales' AND "createdBy" IS NULL AND "archivedAt" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "customers" WHERE "role" = 'C_sales');

UPDATE "capability_overrides" SET "roles" = array_remove("roles", 'C_sales_lead'), "updatedAt" = now()
WHERE "roles" @> ARRAY['C_sales_lead']
  AND EXISTS (SELECT 1 FROM "custom_roles" WHERE "key" = 'C_sales_lead' AND "createdBy" IS NULL AND "archivedAt" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "customers" WHERE "role" = 'C_sales_lead');

DELETE FROM "capability_depot_overrides" d
WHERE d."roleKey" IN ('C_sales', 'C_sales_lead')
  AND EXISTS (SELECT 1 FROM "custom_roles" r WHERE r."key" = d."roleKey" AND r."createdBy" IS NULL AND r."archivedAt" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."role" = d."roleKey");

UPDATE "custom_roles" r SET "archivedAt" = now(), "updatedAt" = now()
WHERE r."key" IN ('C_sales', 'C_sales_lead') AND r."createdBy" IS NULL AND r."archivedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."role" = r."key");

COMMIT;
