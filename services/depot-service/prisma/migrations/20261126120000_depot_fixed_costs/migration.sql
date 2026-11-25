-- HD-16 (D22): fixed costs per depot, month and category, fed by the HQ spreadsheet import.
-- Indexes on the NEW table depot_fixed_costs: depot_fixed_costs_depotId_month_category_key (unique, the upsert key),
-- depot_fixed_costs_month_idx (the HQ view reads one month across depots).
CREATE TABLE "depot_fixed_costs" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountIdr" INTEGER NOT NULL,
    "note" TEXT,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depot_fixed_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "depot_fixed_costs_depotId_month_category_key" ON "depot_fixed_costs"("depotId", "month", "category");

CREATE INDEX "depot_fixed_costs_month_idx" ON "depot_fixed_costs"("month");

ALTER TABLE "depot_fixed_costs" ADD CONSTRAINT "depot_fixed_costs_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
