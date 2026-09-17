-- PYO-3: the payout destination on file, verified by HQ before anything is sent to it.
CREATE TYPE "PayoutSubjectType" AS ENUM ('OWNER', 'COURIER');
CREATE TYPE "BankAccountStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TABLE IF NOT EXISTS "payout_bank_accounts" (
  "id" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "subjectType" "PayoutSubjectType" NOT NULL,
  "bankName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountHolder" TEXT NOT NULL,
  "status" "BankAccountStatus" NOT NULL DEFAULT 'PENDING',
  "verifiedBy" UUID,
  "verifiedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payout_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payout_bank_accounts_subjectId_key"
  ON "payout_bank_accounts" ("subjectId");
CREATE INDEX IF NOT EXISTS "payout_bank_accounts_status_createdAt_idx"
  ON "payout_bank_accounts" ("status", "createdAt");
