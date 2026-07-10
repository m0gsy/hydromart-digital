-- Manual rollback for migration 0001_init (product-service).
DROP TABLE IF EXISTS "products";
DROP TABLE IF EXISTS "categories";
