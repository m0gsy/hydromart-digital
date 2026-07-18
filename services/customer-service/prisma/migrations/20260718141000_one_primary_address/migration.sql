-- Audit DB-2: enforce "at most one primary address per customer" at the database so
-- the invariant survives the (now transactional) setPrimary and any future race.
-- NOTE: if legacy rows already have two primaries, dedupe before applying.
CREATE UNIQUE INDEX IF NOT EXISTS "addresses_one_primary_per_customer"
  ON "addresses"("customerId")
  WHERE "isPrimary";
