-- Admin service integration & governance: API keys (13d), webhook endpoints (19c),
-- data-export logs (13c), scheduled reports (15c). Additive — 0001_init is untouched.

-- CreateEnum
CREATE TYPE "ApiKeyEnvironment" AS ENUM ('PROD', 'STAGING');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('XLSX', 'CSV', 'PDF');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "environment" "ApiKeyEnvironment" NOT NULL DEFAULT 'PROD',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "secret" TEXT,
    "lastDeliveryStatus" TEXT,
    "deliveryRatePct" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_logs" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedByEmail" TEXT NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "rowCount" INTEGER,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cadence" "ReportCadence" NOT NULL,
    "recipients" TEXT[],
    "format" "ExportFormat" NOT NULL DEFAULT 'XLSX',
    "nextRunAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_logs_dataset_idx" ON "export_logs"("dataset");

-- CreateIndex
CREATE INDEX "export_logs_status_idx" ON "export_logs"("status");
