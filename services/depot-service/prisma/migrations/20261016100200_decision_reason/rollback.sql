-- Rollback for 20261016100200_decision_reason: reasons survive only in the audit trail again.
ALTER TABLE "price_override_proposals" DROP COLUMN IF EXISTS "decisionReason";
ALTER TABLE "franchise_applications" DROP COLUMN IF EXISTS "decisionReason";
