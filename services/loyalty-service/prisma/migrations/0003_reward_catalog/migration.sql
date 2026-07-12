-- Points-redeem catalog (FR-015): redeemable reward items + a per-customer
-- redemption ledger. Adds the REDEEM ledger kind (negative spend). Additive.

-- AlterEnum
ALTER TYPE "PointsTxnType" ADD VALUE IF NOT EXISTS 'REDEEM';

-- CreateTable
CREATE TABLE "reward_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "pointsCost" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stock" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL,
    "rewardItemId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_customerId_idempotencyKey_key" ON "reward_redemptions"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "reward_redemptions_customerId_createdAt_idx" ON "reward_redemptions"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_rewardItemId_fkey" FOREIGN KEY ("rewardItemId") REFERENCES "reward_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
