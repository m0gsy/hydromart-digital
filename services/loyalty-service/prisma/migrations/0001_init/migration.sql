-- Loyalty service initial schema (PRD Module 12 Loyalty; BR-013/BR-014).

-- CreateEnum
CREATE TYPE "MembershipTier" AS ENUM ('REGULAR', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "PointsTxnType" AS ENUM ('EARN', 'EXPIRE', 'ADJUST');

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tier" "MembershipTier" NOT NULL DEFAULT 'REGULAR',
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "PointsTxnType" NOT NULL,
    "points" INTEGER NOT NULL,
    "orderId" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "expired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_customerId_key" ON "loyalty_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "points_transactions_orderId_type_key" ON "points_transactions"("orderId", "type");

-- CreateIndex
CREATE INDEX "points_transactions_customerId_createdAt_idx" ON "points_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "points_transactions_type_expired_expiresAt_idx" ON "points_transactions"("type", "expired", "expiresAt");

-- AddForeignKey
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
