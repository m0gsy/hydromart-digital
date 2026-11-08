-- Rolls back 20261108150000_webhook_event_id.
-- Drops the key and its index. A producer that retries a publish would then queue a
-- duplicate delivery again, which is how it behaved before.
DROP INDEX IF EXISTS "webhook_deliveries_endpointId_eventId_key";
ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "eventId";
