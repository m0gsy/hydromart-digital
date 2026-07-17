-- 0004_courier_withdrawals
CREATE TABLE "courier_withdrawals" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bankAccountRef" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PROCESSING',
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_withdrawals_reference_key" ON "courier_withdrawals"("reference");
CREATE INDEX "courier_withdrawals_courierId_createdAt_idx" ON "courier_withdrawals"("courierId", "createdAt");
