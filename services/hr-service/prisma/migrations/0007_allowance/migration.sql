-- Recurring fixed pay components (transport, meal, position…), separate from one-off bonuses.
CREATE TYPE "AllowanceType" AS ENUM ('TRANSPORT', 'MEAL', 'POSITION', 'HOUSING', 'OTHER');

-- Payslips must show an allowance as its own line, not folded into BONUS.
-- IF NOT EXISTS so re-applying after a rollback works: the rollback cannot remove an enum
-- value, so the label is still there on the second run.
ALTER TYPE "PayrollItemKind" ADD VALUE IF NOT EXISTS 'ALLOWANCE';

CREATE TABLE "allowances" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId"    UUID NOT NULL,
  "type"          "AllowanceType" NOT NULL,
  "amount"        DECIMAL(12,2) NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo"   DATE,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "note"          TEXT,
  "createdBy"     UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "allowances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "allowances_employeeId_idx" ON "allowances"("employeeId");

ALTER TABLE "allowances"
  ADD CONSTRAINT "allowances_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
