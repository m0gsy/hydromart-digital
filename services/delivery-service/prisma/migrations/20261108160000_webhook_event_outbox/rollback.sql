-- Rolls back 20261108160000_webhook_event_outbox.
-- Drops the outbox. Lossy for events still PENDING: they are never re-sent, which is how
-- publishing behaved before the table existed (one inline attempt, then gone).
DROP INDEX IF EXISTS "webhook_event_outbox_status_nextAttemptAt_idx";
DROP INDEX IF EXISTS "webhook_event_outbox_eventId_key";
DROP TABLE IF EXISTS "webhook_event_outbox";
