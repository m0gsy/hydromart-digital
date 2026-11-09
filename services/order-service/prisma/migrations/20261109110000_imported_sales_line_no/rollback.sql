-- Rolls back 20261109110000_imported_sales_line_no.
-- Restores one row per receipt. Fails if a multi-line receipt was imported meanwhile: remove its
-- extra lines first (they are the rows with lineNo > 0).
CREATE UNIQUE INDEX IF NOT EXISTS "imported_sales_transactions_depotId_externalRef_key"
  ON "imported_sales_transactions" ("depotId", "externalRef");
DROP INDEX IF EXISTS "imported_sales_transactions_depotId_externalRef_lineNo_key";
ALTER TABLE "imported_sales_transactions" DROP COLUMN IF EXISTS "lineNo";
