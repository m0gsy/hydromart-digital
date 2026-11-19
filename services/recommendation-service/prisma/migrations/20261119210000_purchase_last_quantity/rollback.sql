-- Rollback for 20261119210000_purchase_last_quantity.
ALTER TABLE "customer_product_purchases" DROP COLUMN IF EXISTS "lastQuantity";
