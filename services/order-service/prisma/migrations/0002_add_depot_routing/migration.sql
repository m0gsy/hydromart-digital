-- AlterTable: record the fulfilling depot resolved at checkout (FR-098 Top Depot).
ALTER TABLE "orders" ADD COLUMN "depotId" UUID;

-- CreateIndex
CREATE INDEX "orders_depotId_idx" ON "orders"("depotId");
