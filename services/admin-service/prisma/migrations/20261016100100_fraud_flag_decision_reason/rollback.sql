-- Rollback for 20261016100100_fraud_flag_decision_reason: the reason survives only in the
-- audit trail again.
ALTER TABLE "fraud_flags" DROP COLUMN IF EXISTS "decisionReason";
