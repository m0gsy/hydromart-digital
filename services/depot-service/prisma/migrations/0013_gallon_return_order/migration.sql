-- Link a gallon return to the order it was collected against (design 2e: courier records
-- the return at delivery handover; deposit refund derived server-side).
ALTER TABLE "gallon_returns" ADD COLUMN "orderId" UUID;

CREATE INDEX "gallon_returns_orderId_idx" ON "gallon_returns"("orderId");
