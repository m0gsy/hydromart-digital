-- Penugasan lintas depot, tahap 1: data saja. Tidak ada kode yang membaca atau menulis tabel-tabel
-- ini setelah migrasi ini; perilaku HR/payroll hari ini tidak berubah sedikit pun.
--
-- RERUNNABLE: every statement is IF NOT EXISTS / guarded / idempotent, so a re-applied
-- migration is a no-op.
--
-- Additive only: one nullable column, three new tables, one trigger. Nothing is dropped or
-- rewritten. The column is nullable and readers use `homeDepotId ?? depotId`, so a row the
-- backfill below missed behaves exactly as it did before.

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "homeDepotId" UUID;

-- Backfill: until someone is lent out, home and live depot are the same. Idempotent by its
-- WHERE; a second run touches nothing.
UPDATE "employees" SET "homeDepotId" = "depotId" WHERE "homeDepotId" IS NULL AND "depotId" IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE "DepotMoveKind" AS ENUM ('PERMANENT', 'LOAN_START', 'LOAN_END');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DepotAssignmentKind" AS ENUM ('LOAN', 'PERMANENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DepotAssignmentStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DONE', 'CANCELLED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ledger of moves. Append-only (trigger below).
CREATE TABLE IF NOT EXISTS "employee_depot_moves" (
  "id"            UUID            NOT NULL DEFAULT gen_random_uuid(),
  "employeeId"    UUID            NOT NULL,
  "fromDepotId"   UUID,
  "toDepotId"     UUID,
  "effectiveDate" DATE            NOT NULL,
  "kind"          "DepotMoveKind" NOT NULL,
  "seq"           SERIAL          NOT NULL,
  "assignmentId"  UUID,
  "createdBy"     UUID,
  "createdAt"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_depot_moves_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "employee_depot_assignments" (
  "id"             UUID                    NOT NULL DEFAULT gen_random_uuid(),
  "employeeId"     UUID                    NOT NULL,
  "kind"           "DepotAssignmentKind"   NOT NULL DEFAULT 'LOAN',
  "depotId"        UUID                    NOT NULL,
  "startDate"      DATE                    NOT NULL,
  "endDate"        DATE,
  "status"         "DepotAssignmentStatus" NOT NULL DEFAULT 'PLANNED',
  "appliedStartAt" TIMESTAMP(3),
  "appliedEndAt"   TIMESTAMP(3),
  "attempts"       INTEGER                 NOT NULL DEFAULT 0,
  "failReason"     TEXT,
  "createdByRole"  TEXT,
  "createdBy"      UUID,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)            NOT NULL,
  CONSTRAINT "employee_depot_assignments_pkey" PRIMARY KEY ("id"),
  -- A loan ends on or after the day it starts, and must say when; a permanent move has no end.
  CONSTRAINT "employee_depot_assignments_dates_check" CHECK (
    ("kind" = 'LOAN' AND "endDate" IS NOT NULL AND "endDate" >= "startDate")
    OR ("kind" = 'PERMANENT' AND "endDate" IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS "payroll_depot_shares" (
  "id"        UUID          NOT NULL DEFAULT gen_random_uuid(),
  "payrollId" UUID          NOT NULL,
  "depotId"   UUID          NOT NULL,
  "days"      INTEGER       NOT NULL DEFAULT 0,
  "gross"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  "bonus"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  "deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "shortfall" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "net"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT "payroll_depot_shares_pkey" PRIMARY KEY ("id"),
  -- No depot is ever handed a negative part of a payslip.
  CONSTRAINT "payroll_depot_shares_nonneg_check" CHECK (
    "days" >= 0 AND "gross" >= 0 AND "bonus" >= 0 AND "deduction" >= 0
    AND "shortfall" >= 0 AND "net" >= 0
  )
);

DO $$ BEGIN
  ALTER TABLE "employee_depot_moves"
    ADD CONSTRAINT "employee_depot_moves_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "employee_depot_assignments"
    ADD CONSTRAINT "employee_depot_assignments_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payroll_depot_shares"
    ADD CONSTRAINT "payroll_depot_shares_payrollId_fkey"
    FOREIGN KEY ("payrollId") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "employee_depot_moves_employeeId_effectiveDate_idx"
  ON "employee_depot_moves"("employeeId", "effectiveDate");
CREATE INDEX IF NOT EXISTS "employee_depot_assignments_employeeId_startDate_idx"
  ON "employee_depot_assignments"("employeeId", "startDate");
CREATE INDEX IF NOT EXISTS "employee_depot_assignments_status_startDate_idx"
  ON "employee_depot_assignments"("status", "startDate");
CREATE INDEX IF NOT EXISTS "employee_depot_assignments_status_endDate_idx"
  ON "employee_depot_assignments"("status", "endDate");
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_depot_shares_payrollId_depotId_key"
  ON "payroll_depot_shares"("payrollId", "depotId");
CREATE INDEX IF NOT EXISTS "payroll_depot_shares_depotId_payrollId_idx"
  ON "payroll_depot_shares"("depotId", "payrollId");

-- The ledger is history: a correction is a new row, never an edit. DELETE stays allowed
-- because an employee erased under UU PDP takes their rows with them (ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION employee_depot_moves_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'employee_depot_moves is append-only: write a new row instead of editing %', OLD."id";
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "employee_depot_moves_no_update" ON "employee_depot_moves";
CREATE TRIGGER "employee_depot_moves_no_update"
  BEFORE UPDATE ON "employee_depot_moves"
  FOR EACH ROW EXECUTE FUNCTION employee_depot_moves_no_update();
