-- Rolls back 20261125100000_delivery_sla_stored.
-- Drops the stored verdicts; reports and courier pay go back to the computed on-time (assignedAt
-- clock). Lossy only for the verdicts themselves, which are derivable from the old formula.
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "slaOnTime";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "slaThresholdMinutes";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "slaStartedAt";
