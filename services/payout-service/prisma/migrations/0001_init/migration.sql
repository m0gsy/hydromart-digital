-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('SALE_SETTLEMENT', 'COMMISSION', 'STOCK_PURCHASE', 'WITHDRAWAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PROCESSING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "franchiseOwnerId" UUID NOT NULL,
    "depotId" UUID,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "franchiseOwnerId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bankAccountRef" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PROCESSING',
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_entries_franchiseOwnerId_occurredAt_idx" ON "ledger_entries"("franchiseOwnerId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_reference_key" ON "withdrawals"("reference");

-- CreateIndex
CREATE INDEX "withdrawals_franchiseOwnerId_createdAt_idx" ON "withdrawals"("franchiseOwnerId", "createdAt");
