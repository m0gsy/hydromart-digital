-- 0008_cash_settlement
CREATE TYPE "SettlementStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'DISPUTED');

CREATE TABLE "cash_settlements" (
    "id" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'SUBMITTED',
    "orderIds" UUID[],
    "expectedAmount" INTEGER NOT NULL,
    "depositedAmount" INTEGER NOT NULL,
    "variance" INTEGER NOT NULL,
    "chargedToDriver" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "verifiedBy" UUID,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_settlements_shiftId_key" ON "cash_settlements"("shiftId");
CREATE INDEX "cash_settlements_depotId_status_idx" ON "cash_settlements"("depotId", "status");
CREATE INDEX "cash_settlements_driverId_createdAt_idx" ON "cash_settlements"("driverId", "createdAt");
