-- Leave management: an application with two approval stages, plus a yearly quota per employee.
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'PERMISSION', 'EMERGENCY');
CREATE TYPE "LeaveStatus" AS ENUM (
  'PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED', 'CANCELLED'
);

CREATE TABLE "leave_requests" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId"       UUID NOT NULL,
  "depotId"          UUID NOT NULL,
  "type"             "LeaveType" NOT NULL,
  "startDate"        DATE NOT NULL,
  "endDate"          DATE NOT NULL,
  -- Frozen at submit time from the calendar then in force, so a holiday added later cannot
  -- change a decision already taken.
  "workingDays"      INTEGER NOT NULL,
  "reason"           TEXT NOT NULL,
  "attachmentUrl"    TEXT,
  "status"           "LeaveStatus" NOT NULL DEFAULT 'PENDING_MANAGER',
  "managerDecidedBy" UUID,
  "managerDecidedAt" TIMESTAMP(3),
  "hrDecidedBy"      UUID,
  "hrDecidedAt"      TIMESTAMP(3),
  "decisionNote"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_requests_employeeId_idx" ON "leave_requests"("employeeId");
CREATE INDEX "leave_requests_depotId_status_idx" ON "leave_requests"("depotId", "status");

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "leave_balances" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "year"       INTEGER NOT NULL,
  "quotaDays"  INTEGER NOT NULL,
  "usedDays"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_balances_employeeId_year_key"
  ON "leave_balances"("employeeId", "year");

ALTER TABLE "leave_balances"
  ADD CONSTRAINT "leave_balances_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
