-- RERUNNABLE: the fixed reason a delivery failed (courier's pick, NO_SHOW, DEPOT_CANCELLED).
-- Nullable: rows failed before this stay NULL and readers classify them from "failureReason".
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "failureReasonCode" TEXT;
