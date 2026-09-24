-- PRD-1: the base price is the number every depot sells from, any `catalogWrite` holder can
-- edit it, and the row simply changed — afterwards nobody could say what it had been, who
-- moved it, or when.
--
-- Append-only, and deliberately NOT backfilled: there is no honest value to write for the
-- changes nobody recorded. The trail starts here.
CREATE TABLE "product_price_changes" (
  "id"        TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "changedBy" TEXT NOT NULL,
  "fromPrice" DECIMAL(12,2) NOT NULL,
  "toPrice"   DECIMAL(12,2) NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_price_changes_pkey" PRIMARY KEY ("id")
);

-- The read is always "this product, newest first"; small table, created with the table so
-- there is nothing to build CONCURRENTLY later (audit H-39).
CREATE INDEX "product_price_changes_productId_changedAt_idx"
  ON "product_price_changes" ("productId", "changedAt");
