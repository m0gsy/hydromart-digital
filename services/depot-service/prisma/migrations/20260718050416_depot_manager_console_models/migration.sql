-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('WRONG_ITEM', 'NOT_RECEIVED', 'OVERCHARGED', 'QUALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeResolution" AS ENUM ('REFUND', 'RESEND', 'REJECTED');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('DUE', 'SOON', 'HEALTHY', 'NEW');

-- CreateEnum
CREATE TYPE "SubscriptionCadence" AS ENUM ('DAILY', 'EVERY_3_DAYS', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "depot_targets" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "revenueTargetIdr" INTEGER NOT NULL DEFAULT 0,
    "ordersTarget" INTEGER NOT NULL DEFAULT 0,
    "slaTargetPct" INTEGER NOT NULL DEFAULT 0,
    "newCustomersTarget" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depot_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashbook_entries" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountIdr" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRef" TEXT,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashbook_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_disputes" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "orderRef" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "category" "DisputeCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amountIdr" INTEGER NOT NULL DEFAULT 0,
    "courierName" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "DisputeResolution",
    "resolutionNote" TEXT,
    "raisedBy" UUID NOT NULL,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_items" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "lastServicedAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'HEALTHY',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wholesale_tiers" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "productId" UUID,
    "label" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "maxQty" INTEGER,
    "priceIdr" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wholesale_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "customerId" UUID,
    "customerName" TEXT NOT NULL,
    "productLabel" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cadence" "SubscriptionCadence" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "huddle_notes" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "weekStart" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendance" TEXT,
    "agenda" JSONB NOT NULL DEFAULT '[]',
    "actionItems" JSONB NOT NULL DEFAULT '[]',
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "huddle_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_handovers" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "fromShift" TEXT NOT NULL,
    "toShift" TEXT NOT NULL,
    "fromStaff" TEXT NOT NULL,
    "toStaff" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "signedAt" TIMESTAMP(3),
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "depot_targets_depotId_idx" ON "depot_targets"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "depot_targets_depotId_month_key" ON "depot_targets"("depotId", "month");

-- CreateIndex
CREATE INDEX "cashbook_entries_depotId_occurredAt_idx" ON "cashbook_entries"("depotId", "occurredAt");

-- CreateIndex
CREATE INDEX "order_disputes_depotId_status_createdAt_idx" ON "order_disputes"("depotId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "maintenance_items_depotId_nextDueAt_idx" ON "maintenance_items"("depotId", "nextDueAt");

-- CreateIndex
CREATE INDEX "wholesale_tiers_depotId_idx" ON "wholesale_tiers"("depotId");

-- CreateIndex
CREATE INDEX "subscriptions_depotId_status_idx" ON "subscriptions"("depotId", "status");

-- CreateIndex
CREATE INDEX "huddle_notes_depotId_idx" ON "huddle_notes"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "huddle_notes_depotId_weekStart_key" ON "huddle_notes"("depotId", "weekStart");

-- CreateIndex
CREATE INDEX "shift_handovers_depotId_createdAt_idx" ON "shift_handovers"("depotId", "createdAt");
