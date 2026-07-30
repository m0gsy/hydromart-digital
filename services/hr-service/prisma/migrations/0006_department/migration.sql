-- Department (org unit). depotId NULL = network-wide; a depotId scopes it to one depot.
CREATE TABLE "departments" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "depotId"   UUID,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");
CREATE INDEX "departments_depotId_idx" ON "departments"("depotId");

-- No backfill on purpose: guessing which unit an existing employee belongs to would be
-- fabricated data. They stay NULL and the console shows "Belum diatur".
ALTER TABLE "employees" ADD COLUMN "departmentId" UUID;
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");
