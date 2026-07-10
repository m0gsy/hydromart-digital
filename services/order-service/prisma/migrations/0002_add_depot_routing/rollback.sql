-- Manual rollback for migration 0002_add_depot_routing (order-service).
DROP INDEX IF EXISTS "orders_depotId_idx";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "depotId";
