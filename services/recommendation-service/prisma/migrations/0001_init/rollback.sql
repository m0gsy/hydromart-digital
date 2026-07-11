-- Rollback for 0001_init.
DROP TABLE IF EXISTS "customer_product_purchases";
DROP TABLE IF EXISTS "product_co_buys";
DROP TABLE IF EXISTS "product_daily_sales";
DROP TABLE IF EXISTS "product_refs";
DROP TABLE IF EXISTS "ingested_orders";
