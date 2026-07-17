-- 0005_expense_claims
CREATE TYPE "ExpenseClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ExpenseCategory" AS ENUM ('FUEL', 'PARKING_TOLL', 'VEHICLE_REPAIR', 'OTHER');

CREATE TABLE "expense_claims" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "depotId" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "receiptUrl" TEXT,
    "status" "ExpenseClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "ledgerEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_claims_depotId_status_idx" ON "expense_claims"("depotId", "status");
CREATE INDEX "expense_claims_courierId_createdAt_idx" ON "expense_claims"("courierId", "createdAt");
