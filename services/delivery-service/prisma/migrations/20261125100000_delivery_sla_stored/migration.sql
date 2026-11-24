-- RERUNNABLE: HD-6 #19/#20. The on-time verdict is stored when a delivery completes, with the
-- threshold behind it and the instant its SLA clock started. Nullable: rows completed before
-- this stay NULL ("not stored") and keep being graded by the old computation.
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "slaStartedAt" TIMESTAMP(3);
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "slaThresholdMinutes" INTEGER;
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "slaOnTime" BOOLEAN;
