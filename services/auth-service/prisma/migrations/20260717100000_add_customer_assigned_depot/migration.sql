ALTER TABLE "customers" ADD COLUMN "assignedDepotId" UUID;

CREATE INDEX "customers_assignedDepotId_idx" ON "customers"("assignedDepotId");
