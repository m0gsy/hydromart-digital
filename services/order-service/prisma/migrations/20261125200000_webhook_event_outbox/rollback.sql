-- Rollback for 20261125200000_webhook_event_outbox (HD-17B).
-- NOT lossless: this drops the outbox, so order events still PENDING (not yet delivered to
-- admin-service) are lost; DONE rows are only history. Roll the code back first (the release
-- before this one never writes the table), let the relay drain if you can, then run this.
DROP INDEX IF EXISTS "webhook_event_outbox_status_nextAttemptAt_idx";
DROP INDEX IF EXISTS "webhook_event_outbox_eventId_key";
DROP TABLE IF EXISTS "webhook_event_outbox";
