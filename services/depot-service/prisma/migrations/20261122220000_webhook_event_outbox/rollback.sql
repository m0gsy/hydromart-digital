-- Rolls back 20261122220000_webhook_event_outbox (depot-service, HD-7).
-- Drops the outbox. Lossy for events still PENDING: they are never sent. A franchise application
-- itself is untouched; only the notification that it arrived is lost.
DROP INDEX IF EXISTS "webhook_event_outbox_status_nextAttemptAt_idx";
DROP INDEX IF EXISTS "webhook_event_outbox_eventId_key";
DROP TABLE IF EXISTS "webhook_event_outbox";
