-- Rollback for 20260923160000_product_price_audit. Drops the trail with the table: the
-- price changes recorded since it shipped are not recoverable afterwards.
DROP TABLE IF EXISTS "product_price_changes";
