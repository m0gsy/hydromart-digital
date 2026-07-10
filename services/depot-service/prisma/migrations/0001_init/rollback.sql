-- Manual rollback for migration 0001_init (depot-service).
DROP TABLE IF EXISTS "stock_movements";
DROP TABLE IF EXISTS "inventory_items";
DROP TABLE IF EXISTS "depots";
DROP TYPE IF EXISTS "StockMovementType";
DROP TYPE IF EXISTS "InventoryItemType";
DROP TYPE IF EXISTS "OwnershipType";
