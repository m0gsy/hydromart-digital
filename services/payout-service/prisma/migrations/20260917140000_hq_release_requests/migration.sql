-- PYO-2: maker-checker for HQ releases. One PENDING request per owner at a time, so two
-- requesters cannot queue the same balance twice for two approvers to pay.
CREATE TYPE "ReleaseRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE IF NOT EXISTS "hq_release_requests" (
  "id" UUID NOT NULL,
  "franchiseOwnerId" UUID NOT NULL,
  "bankAccountRef" TEXT,
  "amountAtRequest" DECIMAL(14,2) NOT NULL,
  "requestedBy" UUID NOT NULL,
  "status" "ReleaseRequestStatus" NOT NULL DEFAULT 'PENDING',
  "decidedBy" UUID,
  "decidedAt" TIMESTAMP(3),
  "reason" TEXT,
  "withdrawalId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hq_release_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "hq_release_requests_status_createdAt_idx"
  ON "hq_release_requests" ("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "hq_release_requests_one_pending_per_owner"
  ON "hq_release_requests" ("franchiseOwnerId") WHERE "status" = 'PENDING';
