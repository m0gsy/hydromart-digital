-- RERUNNABLE: the four-eyes queue for security-policy and retention-window changes (AAS-14). A new
-- table, nothing existing is touched; nothing reads it until the code that writes it ships.
CREATE TABLE IF NOT EXISTS "policy_change_requests" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "targetId" TEXT,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedBy" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  CONSTRAINT "policy_change_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "policy_change_requests_status_requestedAt_idx"
  ON "policy_change_requests"("status", "requestedAt");
