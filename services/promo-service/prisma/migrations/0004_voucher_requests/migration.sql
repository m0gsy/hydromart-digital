-- CreateTable
CREATE TABLE "voucher_requests" (
    "id" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "depotName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minSpend" INTEGER NOT NULL DEFAULT 0,
    "maxDiscount" INTEGER,
    "usageLimit" INTEGER,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "createdVoucherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voucher_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voucher_requests_status_createdAt_idx" ON "voucher_requests"("status", "createdAt");
