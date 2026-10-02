-- Historical sales transactions bulk-imported from a depot's pre-Hydromart system
-- (items 3/11, 2026 evaluation list). Deliberately a NEW table, not a column on `orders`:
-- that table drives couriers, loyalty, inventory holds and franchise-revenue posting on
-- every write, and a migration on it caused a production incident the same week this was
-- built. This table has no relation to it and no reader walks through any of that machinery.

CREATE TABLE "imported_sales_transactions" (
  "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
  "depotId"       UUID           NOT NULL,
  "externalRef"   TEXT           NOT NULL,
  "occurredAt"    TIMESTAMP(3)   NOT NULL,
  "customerLabel" TEXT,
  "productLabel"  TEXT           NOT NULL,
  "quantity"      INTEGER        NOT NULL,
  "unitPrice"     DECIMAL(12,2)  NOT NULL,
  "lineTotal"     DECIMAL(12,2)  NOT NULL,
  "paymentMethod" TEXT,
  "batchId"       UUID           NOT NULL,
  "importedBy"    TEXT,
  "importedAt"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "imported_sales_transactions_pkey" PRIMARY KEY ("id")
);

-- H-39: deploy builds these CONCURRENTLY first (scripts/create-indexes.sh), so by the
-- time this migration runs they already exist — IF NOT EXISTS makes that a no-op rather
-- than an error. A fresh database (CI, a new environment) has no concurrent build to find,
-- so the migration builds them itself here, where a lock on an empty table costs nothing.
CREATE UNIQUE INDEX IF NOT EXISTS "imported_sales_transactions_depotId_externalRef_key"
  ON "imported_sales_transactions" ("depotId", "externalRef");

-- The report-window read: one depot, a date range.
CREATE INDEX IF NOT EXISTS "imported_sales_transactions_depotId_occurredAt_idx"
  ON "imported_sales_transactions" ("depotId", "occurredAt");

-- Find every row one import run wrote.
CREATE INDEX IF NOT EXISTS "imported_sales_transactions_batchId_idx"
  ON "imported_sales_transactions" ("batchId");
