-- RERUNNABLE: HD-17B, order-service's outbox for webhook events (order.created, order.status_changed).
-- Same table as depot-service's: a row is written in the same transaction as the order change it reports, so an admin-service outage delays the event, it never loses it.
CREATE TABLE IF NOT EXISTS "webhook_event_outbox" (
  "id" UUID NOT NULL,
  "event" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "webhook_event_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_event_outbox_eventId_key"
  ON "webhook_event_outbox"("eventId");
CREATE INDEX IF NOT EXISTS "webhook_event_outbox_status_nextAttemptAt_idx"
  ON "webhook_event_outbox"("status", "nextAttemptAt");
