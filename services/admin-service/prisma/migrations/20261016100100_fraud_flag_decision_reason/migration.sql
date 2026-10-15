-- The reason head office typed when it decided a fraud flag (block / clear / review).
-- The web already sent it (DecisionReasonDto) and only the audit entry kept it, so the
-- queue could not show WHY a flag was cleared once the audit page was out of reach.
-- Nullable: every decision made before this column existed has no recorded reason.
-- RERUNNABLE: ADD COLUMN IF NOT EXISTS.
ALTER TABLE "fraud_flags" ADD COLUMN IF NOT EXISTS "decisionReason" TEXT;
