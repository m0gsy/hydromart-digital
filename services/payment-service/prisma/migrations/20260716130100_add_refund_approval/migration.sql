-- CreateEnum
CREATE TYPE "RefundApproval" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "refundApproval" "RefundApproval" NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE INDEX "payments_refundApproval_idx" ON "payments"("refundApproval");
