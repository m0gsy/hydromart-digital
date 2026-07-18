-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('COURIER_FALL', 'VEHICLE_BREAKDOWN', 'CUSTOMER_CONFLICT', 'POWER_OUTAGE', 'GALLON_DAMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('OPNAME_VARIANCE', 'DEPOSIT_REFUND', 'COD_VARIANCE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HELD');

-- CreateEnum
CREATE TYPE "ShiftKind" AS ENUM ('MORNING', 'EVENING', 'OFF');

-- AlterTable
ALTER TABLE "franchise_applications" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gallon_issues" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gallon_returns" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "price_override_proposals" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pricing_rules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "daysOfWeek" DROP DEFAULT;

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reportedBy" UUID NOT NULL,
    "courierName" TEXT,
    "orderRef" TEXT,
    "resolutionNote" TEXT,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contactPhone" TEXT,
    "categories" TEXT[],
    "onTimeRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "poNumber" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "supplierName" TEXT NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'DRAFT',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "subtotalIdr" INTEGER NOT NULL,
    "shippingIdr" INTEGER NOT NULL DEFAULT 0,
    "totalIdr" INTEGER NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "submittedBy" UUID NOT NULL,
    "subjectRef" TEXT,
    "amountIdr" INTEGER NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "autoPassThreshold" INTEGER NOT NULL,
    "decisionNote" TEXT,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "staffName" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "shift" "ShiftKind" NOT NULL DEFAULT 'OFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_depotId_status_createdAt_idx" ON "incidents"("depotId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "suppliers_depotId_idx" ON "suppliers"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_depotId_code_key" ON "suppliers"("depotId", "code");

-- CreateIndex
CREATE INDEX "purchase_orders_depotId_status_createdAt_idx" ON "purchase_orders"("depotId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_depotId_poNumber_key" ON "purchase_orders"("depotId", "poNumber");

-- CreateIndex
CREATE INDEX "approvals_depotId_status_createdAt_idx" ON "approvals"("depotId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "shift_assignments_depotId_weekStart_idx" ON "shift_assignments"("depotId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignments_depotId_weekStart_staffId_day_key" ON "shift_assignments"("depotId", "weekStart", "staffId", "day");
