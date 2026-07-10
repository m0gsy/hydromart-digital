-- Manual rollback for migration 0001_init (order-service).
DROP TABLE IF EXISTS "order_status_history";
DROP TABLE IF EXISTS "order_items";
DROP TABLE IF EXISTS "orders";
DROP TABLE IF EXISTS "cart_items";
DROP TYPE IF EXISTS "OrderStatus";
