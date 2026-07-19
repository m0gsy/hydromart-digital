-- Audit (DB-2 pattern): enforce "at most one default payment method per customer" at the
-- database so the invariant survives the (now transactional) setDefault and any future race.
-- NOTE: if legacy rows already have two defaults, dedupe before applying.
CREATE UNIQUE INDEX IF NOT EXISTS "saved_payment_methods_one_default_per_customer"
  ON "saved_payment_methods"("customerId")
  WHERE "isDefault";
