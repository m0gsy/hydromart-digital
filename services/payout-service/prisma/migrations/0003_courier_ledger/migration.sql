-- 0003_courier_ledger
CREATE TYPE "CourierLedgerEntryType" AS ENUM ('EARNING', 'DEDUCTION', 'CASH_VARIANCE', 'WITHDRAWAL', 'ADJUSTMENT');

CREATE TABLE "courier_earning_rules" (
    "id" UUID NOT NULL,
    "depotId" UUID,
    "baseFare" DECIMAL(12,2) NOT NULL,
    "peakBonus" DECIMAL(12,2) NOT NULL,
    "onTimeBonus" DECIMAL(12,2) NOT NULL,
    "peakStartHour" INTEGER NOT NULL,
    "peakEndHour" INTEGER NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_earning_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "courier_earning_rules_depotId_effectiveDate_idx" ON "courier_earning_rules"("depotId", "effectiveDate");

CREATE TABLE "courier_ledger_entries" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "depotId" UUID,
    "type" "CourierLedgerEntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceRef" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_ledger_entries_sourceRef_key" ON "courier_ledger_entries"("sourceRef");
CREATE INDEX "courier_ledger_entries_courierId_occurredAt_idx" ON "courier_ledger_entries"("courierId", "occurredAt");

-- Network-default earning rule so couriers start earning before any depot sets its own.
-- Rp 5.000 base + Rp 2.000 peak (17:00–20:00) + Rp 1.000 on-time.
INSERT INTO "courier_earning_rules"
  ("id", "depotId", "baseFare", "peakBonus", "onTimeBonus", "peakStartHour", "peakEndHour", "effectiveDate")
VALUES
  (gen_random_uuid(), NULL, 5000, 2000, 1000, 17, 20, '2026-01-01T00:00:00.000Z');
