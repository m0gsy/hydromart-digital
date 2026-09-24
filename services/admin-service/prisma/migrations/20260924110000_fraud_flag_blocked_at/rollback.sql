-- Rollback for 20260924110000_fraud_flag_blocked_at: clearing goes back to reading the
-- flag's current status, with both failure modes that implies.
ALTER TABLE "fraud_flags" DROP COLUMN IF EXISTS "blockedAt";
