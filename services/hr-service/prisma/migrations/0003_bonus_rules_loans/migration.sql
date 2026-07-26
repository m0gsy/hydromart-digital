-- Fase 2: configurable bonus rule engine + employee loans (kasbon).
CREATE TABLE "bonus_rules" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "depotId"     UUID,
  "bonusType"   "BonusType" NOT NULL,
  "name"        TEXT NOT NULL,
  "metric"      TEXT NOT NULL,
  "op"          TEXT NOT NULL,
  "threshold"   DECIMAL(14,2) NOT NULL,
  "rewardKind"  TEXT NOT NULL,
  "rewardValue" DECIMAL(14,2) NOT NULL,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdBy"   UUID,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bonus_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bonus_rules_depotId_active_idx" ON "bonus_rules" ("depotId", "active");

CREATE TABLE "loans" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId"        UUID NOT NULL,
  "principal"         DECIMAL(14,2) NOT NULL,
  "installmentAmount" DECIMAL(14,2) NOT NULL,
  "startPeriod"       TEXT NOT NULL,
  "note"              TEXT,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "createdBy"         UUID,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "loans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "loans_employeeId_active_idx" ON "loans" ("employeeId", "active");
