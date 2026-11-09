-- RERUNNABLE: a receipt with several products is several rows (ORD-14). Additive: every existing
-- row is line 0 of its receipt, so the widened unique index cannot collide with anything already there.
ALTER TABLE "imported_sales_transactions" ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "imported_sales_transactions_depotId_externalRef_lineNo_key"
  ON "imported_sales_transactions" ("depotId", "externalRef", "lineNo");
DROP INDEX IF EXISTS "imported_sales_transactions_depotId_externalRef_key";
