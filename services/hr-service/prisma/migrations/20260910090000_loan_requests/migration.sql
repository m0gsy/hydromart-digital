-- Kasbon diajukan sendiri: a request is its own row, and the approval is what creates the Loan.
-- RERUNNABLE: every statement is IF NOT EXISTS / guarded, so a re-applied migration is a no-op.

DO $$ BEGIN
  CREATE TYPE "LoanRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "loan_requests" (
  "id"           UUID              NOT NULL DEFAULT gen_random_uuid(),
  "employeeId"   UUID              NOT NULL,
  "depotId"      UUID              NOT NULL,
  "amount"       DECIMAL(14,2)     NOT NULL,
  "reason"       TEXT              NOT NULL,
  "status"       "LoanRequestStatus" NOT NULL DEFAULT 'PENDING',
  "decidedBy"    UUID,
  "decidedAt"    TIMESTAMP(3),
  "decisionNote" TEXT,
  "loanId"       UUID,
  "createdAt"    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "loan_requests_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "loan_requests"
    ADD CONSTRAINT "loan_requests_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "loan_requests_employeeId_createdAt_idx"
  ON "loan_requests"("employeeId", "createdAt");
CREATE INDEX IF NOT EXISTS "loan_requests_depotId_status_idx"
  ON "loan_requests"("depotId", "status");

-- One open request per person. PARTIAL, because a settled request must not block the next
-- one: Prisma cannot express a WHERE on an index, so it lives here and the repository
-- catches the violation rather than reading first and racing another tab.
CREATE UNIQUE INDEX IF NOT EXISTS "loan_requests_employee_pending_key"
  ON "loan_requests"("employeeId") WHERE "status" = 'PENDING';
