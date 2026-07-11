-- Rollback 0002_delivery_depot.
DROP INDEX "deliveries_depotId_idx";
ALTER TABLE "deliveries" DROP COLUMN "depotId";
