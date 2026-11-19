-- Flow PR-7c: the units of the latest order that carried the product, for "Beli lagi".
-- Nullable: rows written before it have no quantity, and the client adds one for those.
ALTER TABLE "customer_product_purchases" ADD COLUMN "lastQuantity" INTEGER;
