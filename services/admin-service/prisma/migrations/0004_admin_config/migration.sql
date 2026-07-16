-- Admin service governance & config: SLA policy (19d), retention & backup (19e), security
-- policy (19b), admin notification prefs (23a), first-run onboarding wizard (23b). Additive
-- — 0001_init / 0002_admin_integration / 0003_admin_ops are untouched.

-- CreateTable
CREATE TABLE "sla_policy" (
    "id" TEXT NOT NULL,
    "onTimeThresholdMinutes" INTEGER NOT NULL DEFAULT 90,
    "healthyBandPct" INTEGER NOT NULL DEFAULT 95,
    "criticalBandPct" INTEGER NOT NULL DEFAULT 85,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "windowLabel" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_status" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "lastBackupAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_policy" (
    "id" TEXT NOT NULL,
    "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "require2fa" BOOLEAN NOT NULL DEFAULT true,
    "ipAllowlist" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notification_prefs" (
    "accountId" TEXT NOT NULL,
    "channels" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_notification_prefs_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "onboarding_state" (
    "id" TEXT NOT NULL,
    "verify2fa" BOOLEAN NOT NULL DEFAULT false,
    "addDepot" BOOLEAN NOT NULL DEFAULT false,
    "inviteHeadOffice" BOOLEAN NOT NULL DEFAULT false,
    "setPricingTax" BOOLEAN NOT NULL DEFAULT false,
    "enablePayments" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_dataset_key" ON "retention_policies"("dataset");

