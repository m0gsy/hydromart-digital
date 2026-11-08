-- RERUNNABLE: the producer's idempotency key for a webhook event (AAS-11). Nullable, so
-- events from producers that send none are untouched; Postgres treats NULLs as distinct in
-- a unique index, so only rows that carry a key can collide.
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "eventId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_endpointId_eventId_key"
  ON "webhook_deliveries"("endpointId", "eventId");
