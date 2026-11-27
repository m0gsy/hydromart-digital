-- Undo 20261127100000_seed_sales_roles. A role someone already holds is left alone (removing it
-- would orphan the account), and so are its grants. Only roles with no holder and no author (the
-- shape this migration writes) are removed; their key is taken out of every capability list first.
-- The override rows themselves stay: they now equal the compiled default, which is harmless.
BEGIN;

UPDATE "capability_overrides" SET "roles" = array_remove("roles", 'C_sales'), "updatedAt" = now()
WHERE "roles" @> ARRAY['C_sales']
  AND EXISTS (SELECT 1 FROM "custom_roles" WHERE "key" = 'C_sales' AND "createdBy" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "customers" WHERE "role" = 'C_sales');

UPDATE "capability_overrides" SET "roles" = array_remove("roles", 'C_sales_lead'), "updatedAt" = now()
WHERE "roles" @> ARRAY['C_sales_lead']
  AND EXISTS (SELECT 1 FROM "custom_roles" WHERE "key" = 'C_sales_lead' AND "createdBy" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "customers" WHERE "role" = 'C_sales_lead');

DELETE FROM "custom_roles" r
WHERE r."key" IN ('C_sales', 'C_sales_lead') AND r."createdBy" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."role" = r."key");

COMMIT;
