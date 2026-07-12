-- Saved payment methods (spec 4f Account → Metode pembayaran). Per-customer
-- reusable payment instruments; management-only, checkout is unaffected. Additive.

-- CreateEnum
CREATE TYPE "SavedPaymentType" AS ENUM ('CASH', 'TRANSFER', 'QRIS', 'EWALLET', 'VA');

-- CreateTable
CREATE TABLE "saved_payment_methods" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "SavedPaymentType" NOT NULL,
    "label" TEXT NOT NULL,
    "maskedIdentifier" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_payment_methods_customerId_idx" ON "saved_payment_methods"("customerId");
