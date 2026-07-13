-- CreateTable
CREATE TABLE "voucher_grants" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voucher_grants_voucherId_customerId_key" ON "voucher_grants"("voucherId", "customerId");

-- CreateIndex
CREATE INDEX "voucher_grants_customerId_idx" ON "voucher_grants"("customerId");

-- AddForeignKey
ALTER TABLE "voucher_grants" ADD CONSTRAINT "voucher_grants_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
